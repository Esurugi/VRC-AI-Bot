import type { Logger } from "pino";

import type { CodexAppServerClient } from "../../codex/app-server-client.js";
import { FORUM_LONGFORM_CODEX_MODEL_PROFILE } from "../../codex/session-policy.js";
import {
  FORUM_RESEARCH_DISTINCT_SOURCE_TARGET,
  FORUM_RESEARCH_MAX_WORKERS,
  forumResearchPlanJsonSchema,
  forumResearchPlanSchema,
  type ForumResearchPlan
} from "../../forum-research/types.js";

export class ForumResearchPlanner {
  constructor(
    private readonly codexClient: CodexAppServerClient,
    private readonly logger: Pick<Logger, "warn">
  ) {}

  async plan(input: {
    messageId: string;
    currentMessage: string;
    starterMessage: string | null;
    isInitialTurn: boolean;
    threadId: string;
  }): Promise<ForumResearchPlan> {
    const threadId = await this.codexClient.startEphemeralThread(
      "read-only",
      FORUM_LONGFORM_CODEX_MODEL_PROFILE
    );

    try {
      const result = await this.codexClient.runJsonTurn({
        threadId,
        inputPayload: {
          kind: "forum_research_planner",
          place_mode: "forum_longform",
          message_id: input.messageId,
          initial_turn: input.isInitialTurn,
          reply_thread_id: input.threadId,
          current_message: input.currentMessage,
          starter_message: input.starterMessage,
          max_workers: FORUM_RESEARCH_MAX_WORKERS,
          distinct_source_target: FORUM_RESEARCH_DISTINCT_SOURCE_TARGET
        },
        allowExternalFetch: false,
        outputSchema: forumResearchPlanJsonSchema,
        parser: (value) => forumResearchPlanSchema.parse(value),
        modelProfile: FORUM_LONGFORM_CODEX_MODEL_PROFILE,
        timeoutMs: 30_000
      });

      return result.response;
    } catch (error) {
      const normalizedError = wrapForumPlannerError(error);
      this.logger.warn(
        {
          error: normalizedError.message,
          messageId: input.messageId,
          forumThreadId: input.threadId
        },
        "forum research planner failed"
      );
      throw normalizedError;
    } finally {
      await this.codexClient.closeEphemeralThread(threadId).catch(() => undefined);
    }
  }
}

function wrapForumPlannerError(error: unknown): Error {
  const normalized =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : String(error));
  if (!normalized.message.toLowerCase().includes("timed out")) {
    return normalized;
  }

  const wrapped = new Error(`forum research planner timed out: ${normalized.message}`);
  Object.assign(wrapped, {
    code: "FORUM_RESEARCH_PLANNER_TIMEOUT",
    cause: normalized
  });
  return wrapped;
}
