import type { Logger } from "pino";
import type { HarnessRequest, PublicSourceFailure } from "../../harness/contracts.js";
import type { ForumResearchWorkerPacket, ForumResearchProgress } from "../../forum-research/types.js";

import type { CodexAppServerClient } from "../../codex/app-server-client.js";
import type { TurnExecutionContext } from "../../codex/turn-execution-context.js";
import { FORUM_RESEARCH_SUPERVISOR_CODEX_MODEL_PROFILE } from "../../codex/session-policy.js";
import {
  FORUM_RESEARCH_DISTINCT_SOURCE_TARGET,
  FORUM_RESEARCH_MAX_WORKERS,
  forumResearchSupervisorDecisionJsonSchema,
  forumResearchSupervisorDecisionSchema,
  type ForumResearchSourceCatalogEntry,
  type ForumResearchSupervisorDecision,
  type PersistedForumResearchState
} from "../../forum-research/types.js";

export class ForumResearchSupervisor {
  constructor(
    private readonly codexClient: CodexAppServerClient,
    private readonly logger: Pick<Logger, "warn">
  ) {}

  async startSession() {
    const threadId = await this.codexClient.startEphemeralThread(
      "read-only", FORUM_RESEARCH_SUPERVISOR_CODEX_MODEL_PROFILE
    );
    return {
      decide: (input: Parameters<ForumResearchSupervisor["decide"]>[1]) => this.decide(threadId, input),
      close: () => this.codexClient.closeEphemeralThread(threadId)
    };
  }

  private async decide(threadId: string, input: {
    messageId: string;
    threadId: string;
    refinedPrompt: string;
    originalRequest: HarnessRequest;
    publicSourceFailures: PublicSourceFailure[];
    workerProgress: Array<ForumResearchProgress & { worker_id: string }>;
    recentProgressNotices: string[];
    executionContext: TurnExecutionContext;
    previousDecisionApplied: boolean | null;
    activeWorkers: Array<{
      worker_id: string;
      question: string;
      search_focus: string;
      state: "running" | "failed" | "interrupted";
    }>;
    completedWorkers: ForumResearchWorkerPacket[];
    currentSourceCatalog: ForumResearchSourceCatalogEntry[];
    previousResearchState?: PersistedForumResearchState | null;
  }): Promise<ForumResearchSupervisorDecision> {
    try {
      const result = await this.codexClient.runJsonTurn({
        threadId,
        inputPayload: {
          kind: "forum_research_supervisor",
          place_mode: "forum_longform",
          message_id: input.messageId,
          reply_thread_id: input.threadId,
          original_request: {
            ...input.originalRequest,
            available_context: { ...input.originalRequest.available_context, public_source_failures: input.publicSourceFailures }
          },
          refined_prompt: input.refinedPrompt,
          previous_decision_applied: input.previousDecisionApplied,
          worker_progress: input.workerProgress,
          recent_progress_notices: input.recentProgressNotices,
          active_workers: input.activeWorkers,
          completed_workers: input.completedWorkers,
          current_source_catalog: input.currentSourceCatalog,
          previous_research_state: input.previousResearchState ?? null,
          max_workers: FORUM_RESEARCH_MAX_WORKERS,
          distinct_source_target: FORUM_RESEARCH_DISTINCT_SOURCE_TARGET
        },
        allowExternalFetch: input.originalRequest.capabilities.allow_external_fetch,
        executionContext: input.executionContext,
        outputSchema: forumResearchSupervisorDecisionJsonSchema,
        parser: (value) => forumResearchSupervisorDecisionSchema.parse(value),
        modelProfile: FORUM_RESEARCH_SUPERVISOR_CODEX_MODEL_PROFILE
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
    }
  }
}
