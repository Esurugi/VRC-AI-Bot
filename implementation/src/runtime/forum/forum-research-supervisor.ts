import type { Logger } from "pino";

import type { CodexAppServerClient } from "../../codex/app-server-client.js";
import { FORUM_LONGFORM_CODEX_MODEL_PROFILE } from "../../codex/session-policy.js";
import {
  FORUM_RESEARCH_DISTINCT_SOURCE_TARGET,
  FORUM_RESEARCH_MAX_WORKERS,
  forumResearchSupervisorDecisionJsonSchema,
  forumResearchSupervisorDecisionSchema,
  type ForumResearchEvidenceItem,
  type ForumResearchSourceCatalogEntry,
  type ForumResearchSupervisorDecision,
  type PersistedForumResearchState
} from "../../forum-research/types.js";

export class ForumResearchSupervisor {
  constructor(
    private readonly codexClient: CodexAppServerClient,
    private readonly logger: Pick<Logger, "warn">
  ) {}

  async decide(input: {
    messageId: string;
    threadId: string;
    refinedPrompt: string;
    activeWorkers: Array<{
      worker_id: string;
      question: string;
      search_focus: string;
      state: "running" | "failed" | "interrupted";
    }>;
    completedWorkers: Array<{
      worker_id: string;
      subquestion: string;
    }>;
    currentEvidenceItems: ForumResearchEvidenceItem[];
    currentSourceCatalog: ForumResearchSourceCatalogEntry[];
    previousResearchState?: PersistedForumResearchState | null;
  }): Promise<ForumResearchSupervisorDecision> {
    const threadId = await this.codexClient.startEphemeralThread(
      "read-only",
      FORUM_LONGFORM_CODEX_MODEL_PROFILE
    );

    try {
      const result = await this.codexClient.runJsonTurn({
        threadId,
        inputPayload: {
          kind: "forum_research_supervisor",
          place_mode: "forum_longform",
          message_id: input.messageId,
          reply_thread_id: input.threadId,
          refined_prompt: input.refinedPrompt,
          active_workers: input.activeWorkers,
          completed_workers: input.completedWorkers,
          current_evidence_items: input.currentEvidenceItems,
          current_source_catalog: input.currentSourceCatalog,
          previous_research_state: input.previousResearchState ?? null,
          max_workers: FORUM_RESEARCH_MAX_WORKERS,
          distinct_source_target: FORUM_RESEARCH_DISTINCT_SOURCE_TARGET
        },
        allowExternalFetch: false,
        outputSchema: forumResearchSupervisorDecisionJsonSchema,
        parser: (value) => forumResearchSupervisorDecisionSchema.parse(value),
        modelProfile: FORUM_LONGFORM_CODEX_MODEL_PROFILE
      });

      return result.response;
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: input.messageId,
          forumThreadId: input.threadId
        },
        "forum research supervisor failed"
      );
      throw error;
    } finally {
      await this.codexClient.closeEphemeralThread(threadId).catch(() => undefined);
    }
  }
}
