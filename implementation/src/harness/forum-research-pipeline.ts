import type { Logger } from "pino";

import type {
  CodexAppServerClient,
  HarnessTurnSessionMetadata,
  StreamingTextTurnCallbacks,
  TurnObservations
} from "../codex/app-server-client.js";
import {
  FORUM_LONGFORM_CODEX_MODEL_PROFILE,
  FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE
} from "../codex/session-policy.js";
import {
  canonicalizeUrl,
  isAllowedPublicHttpUrl
} from "../playwright/url-policy.js";
import { appendRuntimeTrace } from "../observability/runtime-trace.js";
import {
  FORUM_RESEARCH_DISTINCT_SOURCE_TARGET,
  FORUM_RESEARCH_MAX_WORKERS,
  forumResearchWorkerResultJsonSchema,
  forumResearchWorkerResultSchema,
  type ForumResearchBundle,
  type ForumResearchPlan,
  type ForumResearchSourceCatalogEntry,
  type ForumResearchWorkerResult,
  type ForumResearchWorkerTask
} from "../forum-research/types.js";
import {
  harnessResponseJsonSchema,
  harnessResponseSchema,
  type HarnessRequest,
  type HarnessResponse
} from "./contracts.js";
import type { ForumResearchPlanner } from "../runtime/forum/forum-research-planner.js";

const WORKER_TIMEOUT_MS = 35_000;
const FINAL_TIMEOUT_MS = 90_000;

export type ForumResearchPipelineState = {
  plan: ForumResearchPlan;
  bundle: ForumResearchBundle;
};

export type ForumResearchRetryCallbacks = {
  onRetryStatus?: (content: string) => Promise<void> | void;
  onRetryStream?: StreamingTextTurnCallbacks;
  onRetryCompleted?: () => Promise<void> | void;
};

export class ForumResearchPipeline {
  constructor(
    private readonly codexClient: CodexAppServerClient,
    private readonly planner: ForumResearchPlanner,
    private readonly logger: Pick<Logger, "warn" | "debug">
  ) {}

  async run(input: {
    request: HarnessRequest;
    threadId: string;
    sessionMetadata: HarnessTurnSessionMetadata;
    precomputedPlan?: ForumResearchPlan | null;
    callbacks?: ForumResearchRetryCallbacks;
  }): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
    state: ForumResearchPipelineState;
    primaryReplyAlreadySent: boolean;
  }> {
    const plan =
      input.precomputedPlan ??
      (await this.planner.plan({
        messageId: input.request.message.id,
        currentMessage: input.request.message.content,
        starterMessage: null,
        isInitialTurn: false,
        threadId: input.request.place.thread_id ?? input.request.place.channel_id
      }));

    appendRuntimeTrace("codex-app-server", "forum_research_plan_created", {
      messageId: input.request.message.id,
      workerCount: plan.worker_tasks.length
    });

    const workerResults = await this.runWorkerWave(input.request, plan);
    const bundle = buildForumResearchBundle(plan, workerResults);
    appendRuntimeTrace("codex-app-server", "forum_research_wave_completed", {
      messageId: input.request.message.id,
      workerCount: plan.worker_tasks.length,
      completedWorkerCount: workerResults.length,
      distinctSourceCount: bundle.distinctSources.length
    });

    const state = {
      plan,
      bundle
    } satisfies ForumResearchPipelineState;

    return this.runFinalWithTimeoutRecovery({
      request: input.request,
      threadId: input.threadId,
      sessionMetadata: input.sessionMetadata,
      state,
      ...(input.callbacks ? { callbacks: input.callbacks } : {})
    });
  }

  async runOutputSafetyRetry(input: {
    request: HarnessRequest;
    threadId: string;
    sessionMetadata: HarnessTurnSessionMetadata;
    state: ForumResearchPipelineState;
  }): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
  }> {
    return this.runFinalJsonTurn({
      request: input.request,
      threadId: input.threadId,
      sessionMetadata: input.sessionMetadata,
      state: input.state,
      retryKind: "output_safety_retry"
    });
  }

  private async runWorkerWave(
    request: HarnessRequest,
    plan: ForumResearchPlan
  ): Promise<ForumResearchWorkerResult[]> {
    const tasks = plan.worker_tasks.slice(0, FORUM_RESEARCH_MAX_WORKERS);
    const results = await Promise.allSettled(
      tasks.map((task) => this.runWorker(request, plan, task))
    );

    const successful: ForumResearchWorkerResult[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        successful.push(result.value);
        continue;
      }

      this.logger.warn(
        {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          messageId: request.message.id
        },
        "forum research worker failed"
      );
    }

    return successful;
  }

  private async runWorker(
    request: HarnessRequest,
    plan: ForumResearchPlan,
    task: ForumResearchWorkerTask
  ): Promise<ForumResearchWorkerResult> {
    const threadId = await this.codexClient.startEphemeralThread(
      "read-only",
      FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE
    );
    appendRuntimeTrace("codex-app-server", "forum_research_worker_started", {
      messageId: request.message.id,
      workerId: task.worker_id
    });

    try {
      const result = await this.codexClient.runJsonTurn({
        threadId,
        inputPayload: {
          kind: "forum_research_worker",
          place_mode: "forum_longform",
          request: {
            message_id: request.message.id,
            message_content: request.message.content,
            urls: request.message.urls,
            thread_id: request.place.thread_id,
            root_channel_id: request.place.root_channel_id
          },
          plan_context: {
            synthesis_brief: plan.synthesis_brief
          },
          task
        },
        allowExternalFetch: true,
        outputSchema: forumResearchWorkerResultJsonSchema,
        parser: (value) => forumResearchWorkerResultSchema.parse(value),
        modelProfile: FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE,
        timeoutMs: WORKER_TIMEOUT_MS
      });

      appendRuntimeTrace("codex-app-server", "forum_research_worker_completed", {
        messageId: request.message.id,
        workerId: task.worker_id,
        citationCount: result.response.citations.length
      });
      return result.response;
    } finally {
      await this.codexClient.closeEphemeralThread(threadId).catch(() => undefined);
    }
  }

  private async runFinalWithTimeoutRecovery(input: {
    request: HarnessRequest;
    threadId: string;
    sessionMetadata: HarnessTurnSessionMetadata;
    state: ForumResearchPipelineState;
    callbacks?: ForumResearchRetryCallbacks;
  }): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
    state: ForumResearchPipelineState;
    primaryReplyAlreadySent: boolean;
  }> {
    try {
      const result = await this.runFinalJsonTurn({
        request: input.request,
        threadId: input.threadId,
        sessionMetadata: input.sessionMetadata,
        state: input.state,
        retryKind: "initial"
      });
      return {
        ...result,
        state: input.state,
        primaryReplyAlreadySent: false
      };
    } catch (error) {
      if (!isTimeoutError(error)) {
        throw error;
      }

      appendRuntimeTrace("codex-app-server", "forum_retry_started", {
        messageId: input.request.message.id,
        retryKind: "timeout_recovery"
      });
      await input.callbacks?.onRetryStatus?.(
        "再試行しています。根拠を整理し直しています。"
      );
      const retried = await this.runStreamingTimeoutRecovery({
        request: input.request,
        threadId: input.threadId,
        sessionMetadata: input.sessionMetadata,
        state: input.state,
        ...(input.callbacks ? { callbacks: input.callbacks } : {})
      });
      return {
        ...retried,
        state: input.state,
        primaryReplyAlreadySent: true
      };
    }
  }

  private async runFinalJsonTurn(input: {
    request: HarnessRequest;
    threadId: string;
    sessionMetadata: HarnessTurnSessionMetadata;
    state: ForumResearchPipelineState;
    retryKind: "initial" | "output_safety_retry";
  }): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
  }> {
    appendRuntimeTrace("codex-app-server", "forum_high_synthesis_started", {
      messageId: input.request.message.id,
      retryKind: input.retryKind,
      distinctSourceCount: input.state.bundle.distinctSources.length
    });

    const result = await this.codexClient.runJsonTurn({
      threadId: input.threadId,
      inputPayload: buildFinalPayload(input.request, input.state, input.retryKind),
      allowExternalFetch: false,
      outputSchema: harnessResponseJsonSchema,
      parser: (value) => harnessResponseSchema.parse(value),
      sessionMetadata: input.sessionMetadata,
      modelProfile: FORUM_LONGFORM_CODEX_MODEL_PROFILE,
      timeoutMs: FINAL_TIMEOUT_MS
    });

    appendRuntimeTrace("codex-app-server", "forum_high_synthesis_completed", {
      messageId: input.request.message.id,
      retryKind: input.retryKind,
      distinctSourceCount: input.state.bundle.distinctSources.length
    });
    return result;
  }

  private async runStreamingTimeoutRecovery(input: {
    request: HarnessRequest;
    threadId: string;
    sessionMetadata: HarnessTurnSessionMetadata;
    state: ForumResearchPipelineState;
    callbacks?: ForumResearchRetryCallbacks;
  }): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
  }> {
    appendRuntimeTrace("codex-app-server", "forum_retry_stream_opened", {
      messageId: input.request.message.id
    });
    const result = await this.codexClient.runStreamingTextTurn({
      threadId: input.threadId,
      inputPayload: buildStreamingRetryPayload(input.request, input.state),
      allowExternalFetch: false,
      sessionMetadata: input.sessionMetadata,
      modelProfile: FORUM_LONGFORM_CODEX_MODEL_PROFILE,
      timeoutMs: FINAL_TIMEOUT_MS,
      callbacks: {
        onAgentMessageDelta: async (delta) => {
          appendRuntimeTrace("codex-app-server", "forum_retry_stream_chunk_sent", {
            messageId: input.request.message.id,
            chunkLength: delta.length
          });
          await input.callbacks?.onRetryStream?.onAgentMessageDelta?.(delta);
        },
        onReasoningSummaryDelta: async (delta) => {
          await input.callbacks?.onRetryStream?.onReasoningSummaryDelta?.(delta);
        }
      }
    });

    appendRuntimeTrace("codex-app-server", "forum_retry_stream_completed", {
      messageId: input.request.message.id
    });
    await input.callbacks?.onRetryCompleted?.();

    return {
      response: synthesizeStreamingResponse(
        result.response,
        input.state.bundle.sourceCatalog
      ),
      observations: result.observations
    };
  }
}

function buildForumResearchBundle(
  plan: ForumResearchPlan,
  workerResults: ForumResearchWorkerResult[]
): ForumResearchBundle {
  const sourceCatalog = buildSourceCatalog(workerResults);
  return {
    plan,
    workerResults,
    distinctSourceTarget: FORUM_RESEARCH_DISTINCT_SOURCE_TARGET,
    distinctSources: sourceCatalog.map((entry) => entry.url),
    sourceCatalog
  };
}

function buildSourceCatalog(
  workerResults: ForumResearchWorkerResult[]
): ForumResearchSourceCatalogEntry[] {
  const byUrl = new Map<string, ForumResearchSourceCatalogEntry>();
  for (const workerResult of workerResults) {
    for (const citation of workerResult.citations) {
      const canonicalUrl = normalizePublicUrl(citation.url);
      if (!canonicalUrl) {
        continue;
      }

      const existing = byUrl.get(canonicalUrl);
      if (existing) {
        existing.claims.push(citation.claim);
        continue;
      }

      byUrl.set(canonicalUrl, {
        index: byUrl.size + 1,
        url: canonicalUrl,
        claims: [citation.claim]
      });
    }
  }

  return [...byUrl.values()];
}

function buildFinalPayload(
  request: HarnessRequest,
  state: ForumResearchPipelineState,
  retryKind: "initial" | "output_safety_retry"
): Record<string, unknown> {
  return {
    ...request,
    capabilities: {
      ...request.capabilities,
      allow_external_fetch: false
    },
    forum_research_plan: state.plan,
    forum_research_bundle: {
      retry_kind: retryKind,
      research_observed: state.bundle.distinctSources.length > 0,
      distinct_source_target: state.bundle.distinctSourceTarget,
      synthesis_brief: state.plan.synthesis_brief,
      worker_results: state.bundle.workerResults,
      source_catalog: state.bundle.sourceCatalog
    }
  };
}

function buildStreamingRetryPayload(
  request: HarnessRequest,
  state: ForumResearchPipelineState
): Record<string, unknown> {
  return {
    kind: "forum_research_streaming_final",
    request: {
      ...request,
      capabilities: {
        ...request.capabilities,
        allow_external_fetch: false
      }
    },
    forum_research_bundle: {
      retry_kind: "timeout_recovery",
      research_observed: state.bundle.distinctSources.length > 0,
      distinct_source_target: state.bundle.distinctSourceTarget,
      synthesis_brief: state.plan.synthesis_brief,
      worker_results: state.bundle.workerResults,
      source_catalog: state.bundle.sourceCatalog
    }
  };
}

function synthesizeStreamingResponse(
  text: string | null,
  sourceCatalog: ForumResearchSourceCatalogEntry[]
): HarnessResponse {
  const publicText = text?.trim() ?? "";
  const citedNumbers = extractCitationNumbers(publicText);
  const sourcesUsed = citedNumbers
    .map((index) => sourceCatalog.find((entry) => entry.index === index)?.url ?? null)
    .filter((url): url is string => Boolean(url));

  return {
    outcome: "chat_reply",
    repo_write_intent: false,
    public_text: publicText || "回答の生成に失敗しました。",
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: sourcesUsed,
    knowledge_writes: [],
    diagnostics: {
      notes: "forum timeout recovery streaming final"
    },
    sensitivity_raise: "none"
  };
}

function extractCitationNumbers(text: string): number[] {
  const matches = [...text.matchAll(/\[(\d+)\]/g)];
  const deduped: number[] = [];
  const seen = new Set<number>();
  for (const match of matches) {
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(parsed) || seen.has(parsed)) {
      continue;
    }
    seen.add(parsed);
    deduped.push(parsed);
  }
  return deduped;
}

function normalizePublicUrl(url: string): string | null {
  if (!isAllowedPublicHttpUrl(url)) {
    return null;
  }

  try {
    return canonicalizeUrl(url);
  } catch {
    return null;
  }
}

function isTimeoutError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.toLowerCase().includes("timed out");
}
