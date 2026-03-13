import { spawn } from "node:child_process";

export type ForumPromptPreparationExecutor = {
  prepareForumFirstTurnPrompt(input: {
    threadId: string;
    starterMessage: string;
  }): Promise<string>;
};

export class CodexExecPromptPreprocessorAdapter
  implements ForumPromptPreparationExecutor
{
  constructor(
    private readonly cwd: string,
    private readonly codexHomePath: string | null,
    private readonly command = "codex",
    private readonly model = "gpt-5.4",
    private readonly timeoutMs = 60_000
  ) {}

  async prepareForumFirstTurnPrompt(input: {
    threadId: string;
    starterMessage: string;
  }): Promise<string> {
    const prompt = buildForumPreprocessorPrompt(input);

    return new Promise((resolve, reject) => {
      const child = spawn(
        this.command,
        [
          "exec",
          "--json",
          "--color",
          "never",
          "--ephemeral",
          "-C",
          this.cwd,
          "-s",
          "read-only",
          "-m",
          this.model,
          "-"
        ],
        {
          cwd: this.cwd,
          env: buildCodexExecEnv(process.env, this.codexHomePath),
          stdio: ["pipe", "pipe", "pipe"]
        }
      );

      let stdout = "";
      let stderr = "";
      let lastAgentMessage: string | null = null;
      let settled = false;
      const timer = setTimeout(() => {
        child.kill();
        if (!settled) {
          settled = true;
          reject(new Error("codex exec prompt preprocessing timed out"));
        }
      }, this.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        for (const line of chunk.split(/\r?\n/u)) {
          const parsed = safeParseJson(line);
          if (
            parsed &&
            parsed.type === "item.completed" &&
            typeof parsed.item === "object" &&
            parsed.item !== null &&
            "type" in parsed.item &&
            parsed.item.type === "agent_message" &&
            "text" in parsed.item &&
            typeof parsed.item.text === "string"
          ) {
            lastAgentMessage = parsed.item.text.trim();
          }
        }
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (settled) {
          return;
        }

        if (code !== 0) {
          settled = true;
          reject(
            new Error(
              `codex exec prompt preprocessing failed (code=${code ?? "null"}): ${stderr || stdout}`
            )
          );
          return;
        }

        if (!lastAgentMessage?.trim()) {
          settled = true;
          reject(new Error("codex exec prompt preprocessing returned no agent message"));
          return;
        }

        settled = true;
        resolve(lastAgentMessage.trim());
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}

function buildForumPreprocessorPrompt(input: {
  threadId: string;
  starterMessage: string;
}): string {
  return [
    "Use the repo-local skill `designing-prompts` from `.agents/skills/designing-prompts`.",
    "Task: convert the forum thread starter into a single replacement user prompt for the Harness core first turn.",
    "This output will be passed directly into a downstream system as the first-turn user input replacement.",
    "Return only that final prompt text, with no surrounding analysis or wrapper sections.",
    "Do not include task analysis, design rationale, headings, markdown fences, labels, or explanations.",
    "Do not mention hidden preprocessing, skills, system prompts, developer instructions, or implementation details.",
    "The downstream system will not show your preprocessing step to the user, so your output must already be the exact prompt body to send.",
    `Forum thread id: ${input.threadId}`,
    "",
    "[Forum Thread Starter]",
    input.starterMessage
  ].join("\n");
}

function buildCodexExecEnv(
  parentEnv: NodeJS.ProcessEnv,
  codexHomePath: string | null
): NodeJS.ProcessEnv {
  if (!codexHomePath) {
    return parentEnv;
  }

  return {
    ...parentEnv,
    CODEX_HOME: codexHomePath
  };
}

function safeParseJson(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}
