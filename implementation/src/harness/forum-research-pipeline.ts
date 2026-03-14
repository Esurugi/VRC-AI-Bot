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
  type ForumResearchWorkerTask,
  type PersistedForumResearchState
} from "../forum-research/types.js";
import {
  harnessResponseJsonSchema,
  harnessResponseSchema,
  type HarnessRequest,
  type HarnessResponse
} from "./contracts.js";
import type { ForumResearchPlanner } from "../runtime/forum/forum-research-planner.js";
import type { SqliteStore } from "../storage/database.js";

const FORUM_REPLY_SLA_MS = 180_000;
const IMMEDIATE_RETRY_RESERVE_MS = 30_000;
const PLANNER_BUDGET_CAP_MS = 45_000;
const FINAL_BUDGET_CAP_MS = 90_000;
const MIN_TURN_BUDGET_MS = 10_000;

export type ForumResearchPipelineState = {
  plan: ForumResearchPlan;
  bundle: ForumResearchBundle;
  persistedState: PersistedForumResearchState | null;
  effectiveUserText: string | null;
};

export type ForumResearchRetryCallbacks = {
  onProgressNotice?: (content: string) => Promise<void> | void;
  onRetryStatus?: (content: string) => Promise<void> | void;
  onRetryStream?: StreamingTextTurnCallbacks;
  onRetryCompleted?: () => Promise<void> | void;
};

type DeadlineBudget = {
  startedAt: number;
  deadlineAt: number;
};

export class ForumResearchPipeline {
  constructor(
    private readonly store: SqliteStore,
    private readonly codexClient: CodexAppServerClient,
    private readonly planner: ForumResearchPlanner,
    private readonly logger: Pick<Logger, "warn" | "debug">
  ) {}

  async run(input: {
    request: HarnessRequest;
    threadId: string;
    sessionMetadata: HarnessTurnSessionMetadata;
    starterMessage?: string | null;
    callbacks?: ForumResearchRetryCallbacks;
  }): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
    state: ForumResearchPipelineState;
    primaryReplyAlreadySent: boolean;
  }> {
    const deadline = startDeadlineBudget();
    const persistedState = this.loadPersistedState(input.sessionMetadata.sessionIdentity);
    const plan = await this.planWithFallback({
      request: input.request,
      threadId: input.threadId,
      sessionMetadata: input.sessionMetadata,
      starterMessage: input.starterMessage ?? null,
      persistedState,
      deadline,
      ...(input.callbacks ? { callbacks: input.callbacks } : {})
    });
    const plannedRequest = applyPlannerOverride(input.request, plan);
    const workerResults = await this.runWorkerWave({
      request: plannedRequest,
      plan,
      deadline
    });
    const bundle = buildForumResearchBundle({
      plan,
      workerResults,
      previousState: persistedState
    });
    const nextState = persistNextResearchState({
      store: this.store,
      sessionIdentity: input.sessionMetadata.sessionIdentity,
      threadId: input.threadId,
      lastMessageId: input.request.message.id,
      plan,
      bundle,
      previousState: persistedState
    });

    appendRuntimeTrace("codex-app-server", "forum_research_wave_completed", {
      messageId: input.request.message.id,
      workerCount: plan.worker_tasks.length,
      completedWorkerCount: workerResults.length,
      distinctSourceCount: bundle.distinctSources.length
    });

    const state: ForumResearchPipelineState = {
      plan,
      bundle,
      persistedState: nextState,
      effectiveUserText: plan.effective_user_text?.trim() || null
    };

    return this.runFinalWithTimeoutRecovery({
      request: plannedRequest,
      threadId: input.threadId,
      sessionMetadata: input.sessionMetadata,
      state,
      deadline,
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
      retryKind: "output_safety_retry",
      timeoutMs: FINAL_BUDGET_CAP_MS
    });
  }

  private async planWithFallback(input: {
    request: HarnessRequest;
    threadId: string;
    sessionMetadata: HarnessTurnSessionMetadata;
    starterMessage: string | null;
    persistedState: PersistedForumResearchState | null;
    deadline: DeadlineBudget;
    callbacks?: ForumResearchRetryCallbacks;
  }): Promise<ForumResearchPlan> {
    const timeoutMs = capBudget({
      deadline: input.deadline,
      reserveMs: IMMEDIATE_RETRY_RESERVE_MS + MIN_TURN_BUDGET_MS,
      capMs: PLANNER_BUDGET_CAP_MS
    });
    try {
      const plan = await this.planner.plan({
        messageId: input.request.message.id,
        currentMessage: input.request.message.content,
        starterMessage: input.starterMessage,
        isInitialTurn: input.persistedState === null,
        threadId: input.threadId,
        previousResearchState: input.persistedState,
        timeoutMs
      });
      appendRuntimeTrace("codex-app-server", "forum_research_plan_created", {
        messageId: input.request.message.id,
        workerCount: plan.worker_tasks.length
      });
      const progressNotice = plan.progress_notice?.trim();
      if (progressNotice) {
        await input.callbacks?.onProgressNotice?.(progressNotice);
      }
      return plan;
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: input.request.message.id,
          sessionIdentity: input.sessionMetadata.sessionIdentity
        },
        "forum research planner fell back to direct final"
      );
      appendRuntimeTrace("codex-app-server", "forum_research_plan_fallback", {
        messageId: input.request.message.id
      });
      return {
        progress_notice: null,
        effective_user_text: null,
        worker_tasks: [],
        synthesis_brief:
          input.persistedState?.plannerBrief?.trim() ||
          "現在の依頼と利用可能な根拠を統合して回答する。",
        evidence_gaps: input.persistedState?.evidenceGaps ?? []
      };
    }
  }

  private async runWorkerWave(input: {
    request: HarnessRequest;
    plan: ForumResearchPlan;
    deadline: DeadlineBudget;
  }): Promise<ForumResearchWorkerResult[]> {
    const tasks = input.plan.worker_tasks.slice(0, FORUM_RESEARCH_MAX_WORKERS);
    if (tasks.length === 0) {
      return [];
    }

    const timeoutMs = capBudget({
      deadline: input.deadline,
      reserveMs: IMMEDIATE_RETRY_RESERVE_MS + MIN_TURN_BUDGET_MS,
      capMs: Math.max(MIN_TURN_BUDGET_MS, Math.floor(remainingBudgetMs(input.deadline) * 0.5))
    });
    const results = await Promise.allSettled(
      tasks.map((task) => this.runWorker(input.request, input.plan, task, timeoutMs))
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
          messageId: input.request.message.id
        },
        "forum research worker failed"
      );
    }

    return successful;
  }

  private async runWorker(
    request: HarnessRequest,
    plan: ForumResearchPlan,
    task: ForumResearchWorkerTask,
    timeoutMs: number
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
          planning_context: {
            synthesis_brief: plan.synthesis_brief,
            evidence_gaps: plan.evidence_gaps
          },
          task
        },
        allowExternalFetch: true,
        outputSchema: forumResearchWorkerResultJsonSchema,
        parser: (value) => forumResearchWorkerResultSchema.parse(value),
        modelProfile: FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE,
        timeoutMs
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
    deadline: DeadlineBudget;
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
        retryKind: "initial",
        timeoutMs: capBudget({
          deadline: input.deadline,
          reserveMs: IMMEDIATE_RETRY_RESERVE_MS,
          capMs: FINAL_BUDGET_CAP_MS
        })
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
        "再試行しています。集まっている根拠から整理し直しています。"
      );
      const retried = await this.runStreamingTimeoutRecovery({
        request: input.request,
        threadId: input.threadId,
        sessionMetadata: input.sessionMetadata,
        state: input.state,
        timeoutMs: capBudget({
          deadline: input.deadline,
          reserveMs: 0,
          capMs: IMMEDIATE_RETRY_RESERVE_MS
        }),
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
    timeoutMs: number;
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
      inputPayload: buildFinalPayload(input.request, input.state, input.retryKind, input.timeoutMs),
      allowExternalFetch: input.request.capabilities.allow_external_fetch,
      outputSchema: harnessResponseJsonSchema,
      parser: (value) => harnessResponseSchema.parse(value),
      sessionMetadata: input.sessionMetadata,
      modelProfile: FORUM_LONGFORM_CODEX_MODEL_PROFILE,
      timeoutMs: input.timeoutMs
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
    timeoutMs: number;
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
      inputPayload: buildStreamingRetryPayload(input.request, input.state, input.timeoutMs),
      allowExternalFetch: input.request.capabilities.allow_external_fetch,
      sessionMetadata: input.sessionMetadata,
      modelProfile: FORUM_LONGFORM_CODEX_MODEL_PROFILE,
      timeoutMs: input.timeoutMs,
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
        input.state.bundle.sourceCatalog,
        result.observations.observed_public_urls
      ),
      observations: result.observations
    };
  }

  private loadPersistedState(sessionIdentity: string): PersistedForumResearchState | null {
    const row = this.store.forumResearchStates.get(sessionIdentity);
    if (!row) {
      return null;
    }

    appendRuntimeTrace("codex-app-server", "forum_research_state_loaded", {
      sessionIdentity,
      threadId: row.thread_id
    });
    return {
      sessionIdentity: row.session_identity,
      threadId: row.thread_id,
      lastMessageId: row.last_message_id,
      plannerBrief: row.planner_brief,
      evidenceGaps: parseStringArray(row.evidence_gaps_json),
      workerResults: parseWorkerResults(row.worker_results_json),
      sourceCatalog: parseSourceCatalog(row.source_catalog_json),
      distinctSources: parseStringArray(row.distinct_sources_json)
    };
  }
}

function startDeadlineBudget(): DeadlineBudget {
  const startedAt = Date.now();
  return {
    startedAt,
    deadlineAt: startedAt + FORUM_REPLY_SLA_MS
  };
}

function remainingBudgetMs(deadline: DeadlineBudget): number {
  return Math.max(0, deadline.deadlineAt - Date.now());
}

function capBudget(input: {
  deadline: DeadlineBudget;
  reserveMs: number;
  capMs: number;
}): number {
  const available = Math.max(
    MIN_TURN_BUDGET_MS,
    remainingBudgetMs(input.deadline) - input.reserveMs
  );
  return Math.max(MIN_TURN_BUDGET_MS, Math.min(input.capMs, available));
}

function applyPlannerOverride(
  request: HarnessRequest,
  plan: ForumResearchPlan
): HarnessRequest {
  const override = plan.effective_user_text?.trim();
  if (!override) {
    return request;
  }

  return {
    ...request,
    message: {
      ...request.message,
      content: override
    }
  };
}

function buildForumResearchBundle(input: {
  plan: ForumResearchPlan;
  workerResults: ForumResearchWorkerResult[];
  previousState: PersistedForumResearchState | null;
}): ForumResearchBundle {
  const sourceCatalog = buildSourceCatalog(
    input.previousState?.sourceCatalog ?? [],
    input.workerResults
  );
  return {
    plan: input.plan,
    workerResults: input.workerResults,
    distinctSourceTarget: FORUM_RESEARCH_DISTINCT_SOURCE_TARGET,
    distinctSources: sourceCatalog.map((entry) => entry.url),
    sourceCatalog
  };
}

function buildSourceCatalog(
  priorCatalog: ForumResearchSourceCatalogEntry[],
  workerResults: ForumResearchWorkerResult[]
): ForumResearchSourceCatalogEntry[] {
  const byUrl = new Map<string, ForumResearchSourceCatalogEntry>();
  for (const prior of priorCatalog) {
    const canonicalUrl = normalizePublicUrl(prior.url);
    if (!canonicalUrl) {
      continue;
    }
    byUrl.set(canonicalUrl, {
      index: 0,
      url: canonicalUrl,
      claims: [...prior.claims]
    });
  }

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
        index: 0,
        url: canonicalUrl,
        claims: [citation.claim]
      });
    }
  }

  return [...byUrl.values()].map((entry, index) => ({
    ...entry,
    index: index + 1
  }));
}

function persistNextResearchState(input: {
  store: SqliteStore;
  sessionIdentity: string;
  threadId: string;
  lastMessageId: string;
  plan: ForumResearchPlan;
  bundle: ForumResearchBundle;
  previousState: PersistedForumResearchState | null;
}): PersistedForumResearchState {
  const mergedWorkerResults = [
    ...(input.previousState?.workerResults ?? []),
    ...input.bundle.workerResults
  ];
  const nextState: PersistedForumResearchState = {
    sessionIdentity: input.sessionIdentity,
    threadId: input.threadId,
    lastMessageId: input.lastMessageId,
    plannerBrief: input.plan.synthesis_brief,
    evidenceGaps: input.plan.evidence_gaps,
    workerResults: mergedWorkerResults,
    sourceCatalog: input.bundle.sourceCatalog,
    distinctSources: input.bundle.distinctSources
  };
  input.store.forumResearchStates.upsert({
    sessionIdentity: nextState.sessionIdentity,
    threadId: nextState.threadId,
    lastMessageId: nextState.lastMessageId,
    plannerBrief: nextState.plannerBrief,
    evidenceGapsJson: JSON.stringify(nextState.evidenceGaps),
    workerResultsJson: JSON.stringify(nextState.workerResults),
    sourceCatalogJson: JSON.stringify(nextState.sourceCatalog),
    distinctSourcesJson: JSON.stringify(nextState.distinctSources)
  });
  appendRuntimeTrace("codex-app-server", "forum_research_state_saved", {
    sessionIdentity: nextState.sessionIdentity,
    threadId: nextState.threadId,
    distinctSourceCount: nextState.distinctSources.length
  });
  return nextState;
}

function buildFinalPayload(
  request: HarnessRequest,
  state: ForumResearchPipelineState,
  retryKind: "initial" | "output_safety_retry",
  deadlineRemainingMs: number
): Record<string, unknown> {
  return {
    ...request,
    forum_research_context: {
      retry_kind: retryKind,
      distinct_source_target: state.bundle.distinctSourceTarget,
      planner_brief: state.plan.synthesis_brief,
      evidence_gaps: state.plan.evidence_gaps,
      current_worker_results: state.bundle.workerResults,
      previous_research_state: state.persistedState,
      source_catalog: state.bundle.sourceCatalog,
      deadline_remaining_ms: deadlineRemainingMs
    }
  };
}

function buildStreamingRetryPayload(
  request: HarnessRequest,
  state: ForumResearchPipelineState,
  deadlineRemainingMs: number
): Record<string, unknown> {
  return {
    kind: "forum_research_streaming_final",
    request,
    forum_research_context: {
      retry_kind: "timeout_recovery",
      distinct_source_target: state.bundle.distinctSourceTarget,
      planner_brief: state.plan.synthesis_brief,
      evidence_gaps: state.plan.evidence_gaps,
      current_worker_results: state.bundle.workerResults,
      previous_research_state: state.persistedState,
      source_catalog: state.bundle.sourceCatalog,
      deadline_remaining_ms: deadlineRemainingMs
    }
  };
}

function synthesizeStreamingResponse(
  text: string | null,
  sourceCatalog: ForumResearchSourceCatalogEntry[],
  observedPublicUrls: string[]
): HarnessResponse {
  const publicText = text?.trim() ?? "";
  const citedNumbers = extractCitationNumbers(publicText);
  const numberedSources = citedNumbers
    .map((index) => sourceCatalog.find((entry) => entry.index === index)?.url ?? null)
    .filter((url): url is string => Boolean(url));
  const observedSources = observedPublicUrls
    .map((url) => normalizePublicUrl(url))
    .filter((url): url is string => Boolean(url));
  const sourcesUsed = dedupeStrings([...numberedSources, ...observedSources]);

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

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseWorkerResults(value: string): ForumResearchWorkerResult[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .map((item) => forumResearchWorkerResultSchema.safeParse(item))
          .filter((item) => item.success)
          .map((item) => item.data)
      : [];
  } catch {
    return [];
  }
}

function parseSourceCatalog(value: string): ForumResearchSourceCatalogEntry[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => {
        if (
          typeof item !== "object" ||
          item === null ||
          typeof item.index !== "number" ||
          typeof item.url !== "string" ||
          !Array.isArray(item.claims)
        ) {
          return null;
        }
        return {
          index: item.index,
          url: item.url,
          claims: item.claims.filter(
            (claim: unknown): claim is string => typeof claim === "string"
          )
        } satisfies ForumResearchSourceCatalogEntry;
      })
      .filter((item): item is ForumResearchSourceCatalogEntry => item !== null);
  } catch {
    return [];
  }
}

function isTimeoutError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.toLowerCase().includes("timed out");
}
