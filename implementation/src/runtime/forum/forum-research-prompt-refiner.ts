import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Logger } from "pino";

import type { CodexAppServerClient } from "../../codex/app-server-client.js";
import { FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE } from "../../codex/session-policy.js";
import {
  promptRefinementArtifactJsonSchema,
  promptRefinementArtifactSchema,
  type PromptRefinementArtifact
} from "../../forum-research/types.js";
import type { ThreadContextKind } from "../../harness/contracts.js";

const PROMPT_REFINER_REFERENCE_PATH = fileURLToPath(
  new URL(
    "../../../references/forum-research-prompt-refiner-contract.md",
    import.meta.url
  )
);

export class ForumResearchPromptRefiner {
  constructor(
    private readonly codexClient: CodexAppServerClient,
    private readonly logger: Pick<Logger, "warn">
  ) {}

  async refine(input: {
    messageId: string;
    currentMessage: string;
    starterMessage: string | null;
    threadId: string;
    threadContext: {
      kind: ThreadContextKind;
      root_channel_id: string;
      reply_thread_id: string | null;
      known_source_urls: string[];
    };
    approvedPublicUrls: string[];
  }): Promise<PromptRefinementArtifact> {
    const ephemeralThreadId = await this.codexClient.startEphemeralThread(
      "read-only",
      FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE
    );

    try {
      const result = await this.codexClient.runJsonTurn({
        threadId: ephemeralThreadId,
        inputPayload: {
          kind: "forum_research_prompt_refiner",
          place_mode: "forum_longform",
          message_id: input.messageId,
          reply_thread_id: input.threadId,
          raw_user_message: input.currentMessage,
          starter_message: input.starterMessage,
          thread_context: input.threadContext,
          existing_public_facts: {
            approved_public_urls: input.approvedPublicUrls,
            known_source_urls: input.threadContext.known_source_urls
          },
          design_skill_reference: loadPromptRefinerReference()
        },
        allowExternalFetch: false,
        outputSchema: promptRefinementArtifactJsonSchema,
        parser: (value) => promptRefinementArtifactSchema.parse(value),
        modelProfile: FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE
      });

      return result.response;
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: input.messageId,
          forumThreadId: input.threadId
        },
        "forum research prompt refiner failed"
      );
      throw error;
    } finally {
      await this.codexClient.closeEphemeralThread(ephemeralThreadId).catch(
        () => undefined
      );
    }
  }
}

let cachedPromptRefinerReference: string | null = null;

function loadPromptRefinerReference(): string {
  if (cachedPromptRefinerReference) {
    return cachedPromptRefinerReference;
  }

  try {
    cachedPromptRefinerReference = readFileSync(
      PROMPT_REFINER_REFERENCE_PATH,
      "utf8"
    ).trim();
  } catch (error) {
    if (!isMissingPromptReference(error)) {
      throw error;
    }
    cachedPromptRefinerReference = DEFAULT_PROMPT_REFINER_REFERENCE;
  }
  return cachedPromptRefinerReference;
}

function isMissingPromptReference(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

const DEFAULT_PROMPT_REFINER_REFERENCE = [
  "Convert the raw forum request into a concise hidden prompt for the forum research supervisor.",
  "",
  "Preserve the user's actual question, constraints, starter message, latest follow-up, fetchable public URLs, and known source URLs.",
  "Frame the task for public-source research and supervisor planning, not for direct conversational answering.",
  "Do not answer the user, perform external research, invent facts or URLs, route by channel name or message length, or include retry/safety/orchestration hints in facts.",
  "",
  "Return only the requested structured object with refined_prompt, progress_notice, and prompt_rationale_summary."
].join("\n");
