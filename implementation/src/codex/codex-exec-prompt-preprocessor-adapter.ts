import { spawn } from "node:child_process";

export type ForumPromptPreparationExecutor = {
  prepareForumFirstTurnPrompt(input: {
    threadId: string;
    starterMessage: string;
  }): Promise<{
    preparedPrompt: string;
    progressNotice: string | null;
  }>;
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
  }): Promise<{
    preparedPrompt: string;
    progressNotice: string | null;
  }> {
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
        resolve(parsePreparationResult(lastAgentMessage.trim()));
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
    "This work has two outputs: a short visible progress notice for Discord, and the hidden final prompt body for the downstream Harness first turn.",
    "Internally, follow the skill's analysis flow, especially the early-phase understanding of implicit constraints, assumptions, and the expected output shape.",
    "Return exactly one JSON object with this shape:",
    '{"progress_notice":"string","final_prompt":"string"}',
    "progress_notice rules:",
    "- One short natural Japanese sentence that is safe to show to the user before the final answer.",
    "- Base it on the Phase 1 understanding of what you are analyzing, not on a raw copy of the user's wording.",
    "- Summarize the direction of thought such as hidden assumptions, comparison axes, output expectations, or decision points.",
    "- Do not mention phases, skills, hidden preprocessing, prompts, system prompts, developer instructions, implementation details, or markdown structure.",
    "final_prompt rules:",
    "- This will be passed directly into a downstream system as the first-turn user input replacement.",
    "- Return only the exact final prompt body content inside the JSON field.",
    "- Do not include task analysis, design rationale, headings, markdown fences, labels, or explanations.",
    "Do not mention hidden preprocessing, skills, system prompts, developer instructions, or implementation details.",
    "The downstream system will not show your preprocessing step to the user, so final_prompt must already be the exact prompt body to send.",
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

function parsePreparationResult(raw: string): {
  preparedPrompt: string;
  progressNotice: string | null;
} {
  const parsed = safeParseJson(raw);
  if (!parsed) {
    return {
      preparedPrompt: raw,
      progressNotice: null
    };
  }

  const preparedPrompt =
    typeof parsed.final_prompt === "string" ? parsed.final_prompt.trim() : "";
  const progressNotice =
    typeof parsed.progress_notice === "string" && parsed.progress_notice.trim()
      ? parsed.progress_notice.trim()
      : null;

  if (preparedPrompt) {
    return {
      preparedPrompt,
      progressNotice
    };
  }

  return {
    preparedPrompt: raw,
    progressNotice: null
  };
}
