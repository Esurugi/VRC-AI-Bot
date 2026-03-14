import type { Logger } from "pino";

import type { CodexAppServerClient } from "../../codex/app-server-client.js";
import { FORUM_LONGFORM_CODEX_MODEL_PROFILE } from "../../codex/session-policy.js";
import {
  FORUM_RESEARCH_DISTINCT_SOURCE_TARGET,
  FORUM_RESEARCH_MAX_WORKERS,
  forumResearchPlanJsonSchema,
  forumResearchPlanSchema,
  type ForumResearchPlan,
  type PersistedForumResearchState
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
    previousResearchState?: PersistedForumResearchState | null;
    timeoutMs?: number;
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
          previous_research_state: input.previousResearchState ?? null,
          max_workers: FORUM_RESEARCH_MAX_WORKERS,
          distinct_source_target: FORUM_RESEARCH_DISTINCT_SOURCE_TARGET
        },
        allowExternalFetch: false,
        outputSchema: forumResearchPlanJsonSchema,
        parser: (value) => forumResearchPlanSchema.parse(value),
        modelProfile: FORUM_LONGFORM_CODEX_MODEL_PROFILE,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
      });

      return result.response;
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: input.messageId,
          forumThreadId: input.threadId
        },
        "forum research planner failed"
      );
      throw error;
    } finally {
      await this.codexClient.closeEphemeralThread(threadId).catch(() => undefined);
    }
  }
}
