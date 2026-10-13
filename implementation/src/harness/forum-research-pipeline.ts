import type { Logger } from "pino";
import { ResearchRunEvidence } from "../forum-research/research-evidence.js";
import { compileForumCitations } from "../forum-research/citations.js";
import { executionContextForHarnessRequest, type TurnExecutionContext } from "../codex/turn-execution-context.js";
import { OutputSafetyGuard } from "./output-safety-guard.js";
import { extractUrls } from "../discord/message-utils.js";

import type {
  CodexAppServerClient,
  HarnessTurnSessionMetadata,
  StreamingTextTurnCallbacks,
  TurnObservations
} from "../codex/app-server-client.js";
import {
  FORUM_RESEARCH_SUPERVISOR_CODEX_MODEL_PROFILE,
  FORUM_RESEARCH_WORKER_CODEX_MODEL_PROFILE
} from "../codex/session-policy.js";
import {
  canonicalizeUrl,
  isAllowedPublicHttpUrl
} from "../playwright/url-policy.js";
import { appendRuntimeTrace } from "../observability/runtime-trace.js";
import {
  FORUM_RESEARCH_DISTINCT_SOURCE_TARGET,
  FORUM_RESEARCH_MAX_WORKERS,
  forumResearchEvidenceItemSchema,
  forumResearchWorkerPacketJsonSchema,
  forumResearchWorkerPacketSchema,
  type ForumResearchBundle,
  type ForumResearchEvidenceItem,
  type ForumResearchSourceCatalogEntry,
  type ForumResearchSupervisorDecision,
  type ForumResearchProgress,
  type ForumResearchWorkerPacket,
  type ForumResearchWorkerTask,
  type PersistedPromptRefinementArtifact,
  type PersistedForumResearchState
} from "../forum-research/types.js";
import {
  type HarnessRequest,
  type HarnessResponse
} from "./contracts.js";
import type { ForumResearchPromptRefiner } from "../runtime/forum/forum-research-prompt-refiner.js";
import type { ForumResearchSupervisor } from "../runtime/forum/forum-research-supervisor.js";
import type { SqliteStore } from "../storage/database.js";

export type ForumResearchPipelineState = {
  mode?: "single";
  starterMessage?: string | null;
  bundle: ForumResearchBundle;
  persistedState: PersistedForumResearchState | null;
  promptArtifact: PersistedPromptRefinementArtifact | null;
  finalBrief: string | null;
  evidence: ResearchRunEvidence;
};

export type ForumResearchRetryCallbacks = {
  signal?: AbortSignal;
  recentProgressNotices?: () => string[];
  onProgressNotice?: (content: string) => Promise<void> | void;
  onRetryStatus?: (content: string) => Promise<void> | void;
  onRetryStream?: StreamingTextTurnCallbacks;
  onRetryCompleted?: () => Promise<void> | void;
  onFinalTextDelta?: (delta: string) => Promise<void> | void;
  onFinalTextCompleted?: () => Promise<void> | void;
};

type WorkerOutcome =
  | {
      type: "completed";
      task: ForumResearchWorkerTask;
      packet: ForumResearchWorkerPacket;
      observations: TurnObservations;
    }
  | {
      type: "failed" | "interrupted";
      task: ForumResearchWorkerTask;
      error: unknown;
    };

type ActiveWorker = {
  task: ForumResearchWorkerTask;
  threadId: string;
  interruptRequested: boolean;
  interrupt: () => Promise<void>;
  completion: Promise<WorkerOutcome>;
  controller: AbortController;
};

type WorkerHistory = {
  completed: ForumResearchWorkerPacket[];
  failed: ForumResearchWorkerTask[];
  interrupted: ForumResearchWorkerTask[];
};

type ForumVisibleRecoveryReason =
  | "final_turn_timeout"
  | "final_turn_protocol_error"
  | "output_safety_regeneration";

type ResearchEvent = { kind: "outcome"; outcome: WorkerOutcome } | { kind: "progress"; workerId: string; notice: ForumResearchProgress };

export class ForumResearchPipeline {
  constructor(
    private readonly store: SqliteStore,
    private readonly codexClient: CodexAppServerClient,
    private readonly promptRefiner: ForumResearchPromptRefiner,
    private readonly supervisor: ForumResearchSupervisor,
    private readonly logger: Pick<Logger, "warn" | "debug">
  ) {}

  async run(input: Parameters<ForumResearchPipeline["runParallel"]>[0]) {
    input.callbacks?.signal?.throwIfAborted();
    const evidence = new ResearchRunEvidence(input.request.available_context.public_source_facts, input.request.available_context.public_source_failures);
    const state: ForumResearchPipelineState = {
      mode: "single", starterMessage: input.starterMessage ?? null,
      evidence, bundle: buildForumResearchBundle({ evidence, currentPackets: [] }),
      persistedState: this.loadPersistedState(input.sessionMetadata.sessionIdentity, input.request.place.thread_id ?? input.request.place.channel_id),
      promptArtifact: null, finalBrief: null
    };
    return this.answer(input, state);
  }

  // Retained for explicit experiments; the normal runner uses run().
  async runParallel(input: {
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
    const promptArtifact = await this.loadOrCreatePromptArtifact({
      request: input.request,
      threadId: input.threadId,
      sessionIdentity: input.sessionMetadata.sessionIdentity,
      starterMessage: input.starterMessage ?? null,
      refreshExisting: shouldRefreshForumPromptArtifact(input.request),
      ...(input.callbacks ? { callbacks: input.callbacks } : {})
    });
    input.callbacks?.signal?.throwIfAborted();
    const persistedState = this.loadPersistedState(input.sessionMetadata.sessionIdentity, input.request.place.thread_id ?? input.request.place.channel_id);
    const researchState = await this.collectResearchState({
      request: input.request,
      threadId: input.threadId,
      sessionMetadata: input.sessionMetadata,
      persistedState,
      promptArtifact,
      ...(input.callbacks ? { callbacks: input.callbacks } : {})
    });

    return this.answer(input, researchState);
  }

  private async answer(input: Parameters<ForumResearchPipeline["runParallel"]>[0], researchState: ForumResearchPipelineState): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
    state: ForumResearchPipelineState;
    primaryReplyAlreadySent: boolean;
  }> {
    try {
      const result = await this.runFinalStreamingTurn({
        request: input.request,
        threadId: input.threadId,
        sessionMetadata: input.sessionMetadata,
        state: researchState,
        retryKind: "initial",
        ...(input.callbacks ? { callbacks: input.callbacks } : {})
      });
      return {
        ...result,
        state: researchState,
        primaryReplyAlreadySent: false
      };
    } catch (error) {
      const reason = classifyRecoverableFinalTurnError(error);
      if (!reason) {
        throw error;
      }

      const retried = await this.runVisibleStreamingRecovery({
        request: input.request,
        threadId: input.threadId,
        sessionMetadata: input.sessionMetadata,
        state: researchState,
        reason,
        ...(input.callbacks ? { callbacks: input.callbacks } : {})
      });
      return {
        ...retried,
        state: researchState,
        primaryReplyAlreadySent: retried.primaryReplyAlreadySent
      };
    }
  }

  async runOutputSafetyRetry(input: {
    request: HarnessRequest;
    threadId: string;
    sessionMetadata: HarnessTurnSessionMetadata;
    state: ForumResearchPipelineState;
    callbacks?: ForumResearchRetryCallbacks;
  }): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
  }> {
    appendRuntimeTrace("codex-app-server", "forum_retry_started", {
      messageId: input.request.message.id,
      retryKind: "output_safety_regeneration"
    });
    await input.callbacks?.onRetryStatus?.(
      buildVisibleRetryStatus("output_safety_regeneration")
    );

    try {
      return await this.runFinalStreamingTurn({
        request: input.request,
        threadId: input.threadId,
        sessionMetadata: input.sessionMetadata,
        state: input.state,
        retryKind: "output_safety_retry",
        ...(input.callbacks ? { callbacks: input.callbacks } : {})
      });
    } catch (error) {
      const reason = classifyRecoverableFinalTurnError(error);
      if (!reason) {
        throw error;
      }

      appendRuntimeTrace("codex-app-server", "forum_retry_terminal_failure", {
        messageId: input.request.message.id,
        retryKind: "output_safety_retry",
        reason
      });
      return {
        response: buildForumTerminalFailureResponse(
          "調査回答の再生成は完了できませんでした。必要なら同じ thread で続けてください。",
          `forum output safety retry failed: ${reason}`
        ),
        observations: {
          observed_public_urls: [],
          generated_images: []
        }
      };
    }
  }

  private async collectResearchState(input: {
    request: HarnessRequest;
    threadId: string;
    sessionMetadata: HarnessTurnSessionMetadata;
    persistedState: PersistedForumResearchState | null;
    promptArtifact: PersistedPromptRefinementArtifact;
    callbacks?: ForumResearchRetryCallbacks;
  }): Promise<ForumResearchPipelineState> {
    const evidence = new ResearchRunEvidence(input.request.available_context.public_source_facts, input.request.available_context.public_source_failures);
    const activeWorkers = new Map<string, ActiveWorker>();
    const launchedWorkerIds = new Set<string>();
    const history: WorkerHistory = { completed: [], failed: [], interrupted: [] };
    const events: ResearchEvent[] = [];
    const reports = new Map<string, ForumResearchProgress>();
    const signal = input.callbacks?.signal;
    let wake: (() => void) | null = null;
    let closed = false;
    let finalBrief: string | null = null;
    let researchSession: Awaited<ReturnType<ForumResearchSupervisor["startSession"]>> | undefined;
    let previousDecisionApplied: boolean | null = null;
    const enqueue = (event: ResearchEvent) => {
      if (closed || signal?.aborted) return;
      events.push(event);
      wake?.();
      wake = null;
    };
    const abort = () => {
      for (const worker of activeWorkers.values()) worker.controller.abort(signal?.reason);
      wake?.();
      wake = null;
    };
    signal?.addEventListener("abort", abort, { once: true });
    const drain = () => {
      for (const event of events.splice(0)) {
        if (event.kind === "progress") {
          reports.set(event.workerId, event.notice);
          continue;
        }
        const outcome = event.outcome;
        activeWorkers.delete(outcome.task.worker_id);
        if (outcome.type === "completed") {
          history.completed.push(outcome.packet);
          appendRuntimeTrace("codex-app-server", "forum_research_worker_completed", {
            messageId: input.request.message.id, workerId: outcome.task.worker_id,
            evidenceCount: outcome.packet.evidence_items.length
          });
        } else if (outcome.type === "interrupted") {
          history.interrupted.push(outcome.task);
        } else {
          history.failed.push(outcome.task);
          this.logger.warn({ messageId: input.request.message.id, workerId: outcome.task.worker_id, error: outcome.error }, "forum research worker failed");
        }
      }
    };
    try {
      researchSession = await this.supervisor.startSession();
      while (true) {
        signal?.throwIfAborted();
        drain();
        const bundle = buildForumResearchBundle({ evidence, currentPackets: history.completed });
        const decision = await researchSession.decide({
          messageId: input.request.message.id,
          threadId: input.threadId,
          originalRequest: input.request,
          refinedPrompt: input.promptArtifact.refinedPrompt,
          activeWorkers: [
            ...[...activeWorkers.values()].map(worker => ({ ...worker.task, state: "running" as const })),
            ...history.failed.map(task => ({ ...task, state: "failed" as const })),
            ...history.interrupted.map(task => ({ ...task, state: "interrupted" as const }))
          ],
          completedWorkers: history.completed,
          currentSourceCatalog: bundle.sourceCatalog,
          publicSourceFailures: evidence.failures,
          workerProgress: [...reports].map(([worker_id, notice]) => ({ worker_id, ...notice })),
          recentProgressNotices: input.callbacks?.recentProgressNotices?.() ?? [],
          previousResearchState: input.persistedState,
          executionContext: this.executionContext(input.request, evidence, signal),
          previousDecisionApplied
        });
        signal?.throwIfAborted();
        // A decision is based on a snapshot. Incorporate events received during it
        // before accepting a final brief or commands for that snapshot.
        if (events.length > 0) { previousDecisionApplied = false; continue; }
        previousDecisionApplied = true;
        if (decision.progress_notice) {
          await this.publishProgress(input.request, evidence, decision.progress_notice, input.callbacks);
        }
        finalBrief = decision.final_brief?.trim() || finalBrief;
        if (decision.next_action !== "launch_workers" && decision.worker_tasks.length > 0) {
          throw new Error("forum supervisor returned tasks without a launch instruction");
        }
        if (decision.next_action === "launch_workers" && decision.worker_tasks.length === 0) {
          throw new Error("forum supervisor requested launch_workers without tasks");
        }
        for (const id of decision.interrupts) {
          const worker = activeWorkers.get(id);
          if (!worker) throw new Error(`forum supervisor requested interrupt for inactive worker: ${id}`);
          if (!worker.interruptRequested) {
            worker.interruptRequested = true;
            worker.controller.abort(new Error("Worker interrupted by research supervisor"));
          }
        }
        if (activeWorkers.size + decision.worker_tasks.length > FORUM_RESEARCH_MAX_WORKERS) {
          throw new Error("forum research supervisor exceeded the worker concurrency limit");
        }
        for (const task of decision.worker_tasks) {
          if (launchedWorkerIds.has(task.worker_id)) throw new Error(`forum supervisor reused worker_id: ${task.worker_id}`);
          launchedWorkerIds.add(task.worker_id);
        }
        await Promise.all(decision.worker_tasks.map(async task => {
          try {
            const worker = await this.startWorker({ request: input.request, task, evidence, enqueue, ...(signal ? { signal } : {}) });
            activeWorkers.set(task.worker_id, worker);
          } catch (error) {
            enqueue({ kind: "outcome", outcome: { type: "failed", task, error } });
          }
        }));
        signal?.throwIfAborted();
        if (decision.next_action === "finalize" && activeWorkers.size === 0) break;
        // The lead can research while the newly launched workers run. Subsequent
        // wait decisions sleep until an actual worker event, without polling.
        if (decision.next_action === "launch_workers") continue;
        if (activeWorkers.size === 0 && events.length === 0) {
          throw new Error("forum supervisor requested waiting without active workers");
        }
        if (events.length === 0) await new Promise<void>(resolve => { wake = resolve; });
      }
      const bundle = buildForumResearchBundle({ evidence, currentPackets: history.completed });
      persistCurrentResearchState({
        store: this.store, sessionIdentity: input.sessionMetadata.sessionIdentity,
        threadId: input.request.place.thread_id ?? input.request.place.channel_id,
        lastMessageId: input.request.message.id, previousState: input.persistedState,
        bundle
      });
      return { bundle, persistedState: input.persistedState, promptArtifact: input.promptArtifact, finalBrief, evidence };
    } finally {
      closed = true;
      signal?.removeEventListener("abort", abort);
      for (const worker of activeWorkers.values()) worker.controller.abort(new Error("Research run ended"));
      await Promise.allSettled([...activeWorkers.values()].map(worker => worker.completion));
      await researchSession?.close().catch(() => undefined);
    }
  }

  private async publishProgress(request: HarnessRequest, evidence: ResearchRunEvidence, notice: ForumResearchProgress, callbacks?: ForumResearchRetryCallbacks): Promise<void> {
    callbacks?.signal?.throwIfAborted();
    const facts = evidence.resolve(notice.evidence_fact_ids);
    const response: HarnessResponse = {
      ...buildForumTerminalFailureResponse(notice.message, "research progress"),
      outcome: "chat_reply", sources_used: dedupeStrings([...facts.map(fact => fact.canonical_item_url), ...extractUrls(notice.message)])
    };
    const guard = new OutputSafetyGuard(this.store);
    const decision = guard.evaluate({
      request: { ...request, available_context: { ...request.available_context, public_source_facts: evidence.facts } },
      response, linkedKnowledgeSources: []
    });
    if (decision.decision !== "allow") {
      this.logger.debug({ reason: decision.reason }, "research progress withheld at public boundary");
      return;
    }
    await callbacks?.onProgressNotice?.(notice.message);
  }

  private executionContext(request: HarnessRequest, evidence: ResearchRunEvidence, signal?: AbortSignal): TurnExecutionContext {
    return {
      ...executionContextForHarnessRequest(request),
      ...(signal ? { signal } : {}),
      readResearchEvidence: factId => evidence.resolve([factId])[0]!,
      onPublicSourceEvidence: result => {
        signal?.throwIfAborted();
        evidence.record(result);
      }
    };
  }

  private async startWorker(input: {
    request: HarnessRequest;
    task: ForumResearchWorkerTask;
    evidence: ResearchRunEvidence;
    enqueue: (event: ResearchEvent) => void;
    signal?: AbortSignal;
  }): Promise<ActiveWorker> {
    const controller = new AbortController();
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    signal.throwIfAborted();
    const threadId = await this.codexClient.startEphemeralThread("read-only", FORUM_RESEARCH_WORKER_CODEX_MODEL_PROFILE);
    let startedTurn;
    try {
      signal.throwIfAborted();
      startedTurn = await this.codexClient.startJsonTurn({
        threadId,
        inputPayload: {
          kind: "forum_research_worker", place_mode: "forum_longform",
          request: { ...input.request, available_context: { ...input.request.available_context, public_source_failures: input.evidence.failures } },
          task: input.task,
          source_catalog: input.evidence.catalog()
        },
        allowExternalFetch: input.request.capabilities.allow_external_fetch,
        executionContext: {
          ...this.executionContext(input.request, input.evidence, signal),
          onResearchProgress: notice => {
            signal.throwIfAborted();
            input.evidence.resolve(notice.evidence_fact_ids);
            input.enqueue({ kind: "progress", workerId: input.task.worker_id, notice });
          }
        },
        outputSchema: forumResearchWorkerPacketJsonSchema,
        parser: value => input.evidence.groundPacket(forumResearchWorkerPacketSchema.parse(value)),
        modelProfile: FORUM_RESEARCH_WORKER_CODEX_MODEL_PROFILE
      });
    } catch (error) {
      await this.codexClient.closeEphemeralThread(threadId).catch(() => undefined);
      throw error;
    }
    const completion: Promise<WorkerOutcome> = startedTurn.completion
      .then(result => {
        signal.throwIfAborted();
        return { type: "completed" as const, task: input.task, packet: result.response, observations: result.observations };
      })
      .catch(error => ({ type: controller.signal.aborted || input.signal?.aborted ? "interrupted" as const : "failed" as const, task: input.task, error }))
      .then(outcome => {
        input.enqueue({ kind: "outcome", outcome });
        return outcome;
      });
    // Closing subscriptions is cleanup; deliver completion before the close RPC.
    void completion.then(() => this.codexClient.closeEphemeralThread(threadId)).catch(() => undefined);
    return { task: input.task, threadId, controller, interruptRequested: false, interrupt: startedTurn.interrupt, completion };
  }

  private async runFinalStreamingTurn(input: {
    request: HarnessRequest;
    threadId: string;
    sessionMetadata: HarnessTurnSessionMetadata;
    state: ForumResearchPipelineState;
    retryKind: "initial" | "output_safety_retry";
    callbacks?: ForumResearchRetryCallbacks;
  }): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
  }> {
    appendRuntimeTrace("codex-app-server", "forum_high_synthesis_started", {
      messageId: input.request.message.id,
      retryKind: input.retryKind,
      distinctSourceCount: input.state.bundle.distinctSources.length
    });
    appendRuntimeTrace("codex-app-server", "forum_normal_final_stream_started", {
      messageId: input.request.message.id,
      retryKind: input.retryKind
    });

    const result = await this.codexClient.runStreamingTextTurn({
      threadId: input.threadId,
      inputPayload: buildStreamingFinalPayload(
        input.request,
        input.state,
        input.retryKind
      ),
      allowExternalFetch: input.request.capabilities.allow_external_fetch,
      sessionMetadata: input.sessionMetadata,
      modelProfile: FORUM_RESEARCH_SUPERVISOR_CODEX_MODEL_PROFILE,
      executionContext: this.answerExecutionContext(input.request, input.state, input.callbacks),
      callbacks: {}
    });

    appendRuntimeTrace("codex-app-server", "forum_high_synthesis_completed", {
      messageId: input.request.message.id,
      retryKind: input.retryKind,
      distinctSourceCount: input.state.bundle.distinctSources.length
    });
    appendRuntimeTrace("codex-app-server", "forum_normal_final_stream_completed", {
      messageId: input.request.message.id,
      retryKind: input.retryKind,
      responseLength: result.response?.length ?? 0
    });
    if (!result.response?.trim()) {
      throw new Error("codex streaming final produced no visible text");
    }
    input.callbacks?.signal?.throwIfAborted();
    const observations = mergeSourceCatalogObservations(result.observations, input.state.evidence);
    this.saveSingleResearchState(input, input.state);

    return {
      response: synthesizeStreamingResponse(
        result.response,
        input.state.evidence.catalog(input.state.bundle.currentWorkerPackets),
        input.retryKind === "initial"
          ? "forum streaming final"
          : "forum output safety streaming final"
      ),
      observations
    };
  }

  private async runVisibleStreamingRecovery(input: {
    request: HarnessRequest;
    threadId: string;
    sessionMetadata: HarnessTurnSessionMetadata;
    state: ForumResearchPipelineState;
    reason: Exclude<ForumVisibleRecoveryReason, "output_safety_regeneration">;
    callbacks?: ForumResearchRetryCallbacks;
  }): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
    primaryReplyAlreadySent: boolean;
  }> {
    appendRuntimeTrace("codex-app-server", "forum_retry_started", {
      messageId: input.request.message.id,
      retryKind: input.reason
    });
    await input.callbacks?.onRetryStatus?.(buildVisibleRetryStatus(input.reason));
    appendRuntimeTrace("codex-app-server", "forum_retry_stream_opened", {
      messageId: input.request.message.id
    });
    try {
      const result = await this.codexClient.runStreamingTextTurn({
        threadId: input.threadId,
        inputPayload: buildStreamingRetryPayload(input.request, input.state, input.reason),
        allowExternalFetch: input.request.capabilities.allow_external_fetch,
        sessionMetadata: input.sessionMetadata,
        modelProfile: FORUM_RESEARCH_SUPERVISOR_CODEX_MODEL_PROFILE,
        executionContext: this.answerExecutionContext(input.request, input.state, input.callbacks),
        callbacks: {
          onAgentMessageDelta: async (delta) => {
            appendRuntimeTrace("codex-app-server", "forum_retry_stream_chunk_sent", {
              messageId: input.request.message.id,
              chunkLength: delta.length
            });
          },
          onReasoningSummaryDelta: async () => {}
        }
      });

      appendRuntimeTrace("codex-app-server", "forum_retry_stream_completed", {
        messageId: input.request.message.id
      });
      await input.callbacks?.onRetryCompleted?.();
      input.callbacks?.signal?.throwIfAborted();
      const observations = mergeSourceCatalogObservations(result.observations, input.state.evidence);
      this.saveSingleResearchState(input, input.state);

      const response = synthesizeStreamingResponse(
        result.response,
        input.state.evidence.catalog(input.state.bundle.currentWorkerPackets),
        "forum visible recovery streaming final"
      );

      return {
        response,
        observations,
        primaryReplyAlreadySent: false
      };
    } catch (error) {
      appendRuntimeTrace("codex-app-server", "forum_retry_terminal_failure", {
        messageId: input.request.message.id,
        retryKind: input.reason,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        response: buildForumTerminalFailureResponse(
          "調査回答の再試行は完了できませんでした。必要なら同じ thread で続けてください。",
          `forum visible recovery failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        ),
        observations: {
          observed_public_urls: [],
          generated_images: []
        },
        primaryReplyAlreadySent: false
      };
    }
  }

  private answerExecutionContext(request: HarnessRequest, state: ForumResearchPipelineState, callbacks?: ForumResearchRetryCallbacks): TurnExecutionContext {
    return {
      ...this.executionContext(request, state.evidence, callbacks?.signal),
      ...(state.mode === "single" ? {
        onResearchProgress: (notice: ForumResearchProgress) => this.publishProgress(request, state.evidence, notice, callbacks)
      } : {})
    };
  }

  private saveSingleResearchState(input: Parameters<ForumResearchPipeline["runParallel"]>[0], state: ForumResearchPipelineState): void {
    if (state.mode !== "single") return;
    state.bundle = buildForumResearchBundle({ evidence: state.evidence, currentPackets: [] });
    persistCurrentResearchState({
      store: this.store, sessionIdentity: input.sessionMetadata.sessionIdentity,
      threadId: input.request.place.thread_id ?? input.request.place.channel_id,
      lastMessageId: input.request.message.id, previousState: state.persistedState, bundle: state.bundle
    });
  }

  private loadPersistedState(sessionIdentity: string, threadId: string): PersistedForumResearchState | null {
    const row = this.store.forumResearchStates.get(sessionIdentity) ?? this.store.forumResearchStates.getLatestForThread(threadId);
    if (!row) {
      return null;
    }

    appendRuntimeTrace("codex-app-server", "forum_research_state_loaded", {
      sessionIdentity,
      threadId: row.thread_id
    });
    const sourceCatalog = parseSourceCatalog(row.source_catalog_json);
    return {
      sessionIdentity: row.session_identity,
      threadId: row.thread_id,
      lastMessageId: row.last_message_id,
      evidenceItems: parseEvidenceItems(row.evidence_items_json, sourceCatalog),
      sourceCatalog,
      distinctSources: parseStringArray(row.distinct_sources_json)
    };
  }

  private async loadOrCreatePromptArtifact(input: {
    request: HarnessRequest;
    threadId: string;
    sessionIdentity: string;
    starterMessage: string | null;
    refreshExisting: boolean;
    callbacks?: ForumResearchRetryCallbacks;
  }): Promise<PersistedPromptRefinementArtifact> {
    const existing = this.loadPromptArtifact(input.sessionIdentity);
    if (existing && !input.refreshExisting) {
      return existing;
    }

    const artifact = await this.promptRefiner.refine({
      messageId: input.request.message.id,
      ...(input.callbacks?.signal ? { signal: input.callbacks.signal } : {}),
      currentMessage: input.request.message.content,
      starterMessage: input.starterMessage,
      threadId: input.threadId,
      threadContext: {
        kind: input.request.available_context.thread_context.kind,
        root_channel_id: input.request.available_context.thread_context.root_channel_id,
        reply_thread_id: input.request.available_context.thread_context.reply_thread_id,
        known_source_urls: input.request.available_context.thread_context.known_source_urls
      },
      approvedPublicUrls: input.request.available_context.approved_public_urls.map(
        (url) => url.canonical_url
      )
    });

    const persistedArtifact = persistPromptArtifact({
      store: this.store,
      sessionIdentity: input.sessionIdentity,
      threadId: input.threadId,
      lastMessageId: input.request.message.id,
      artifact
    });
    const progressNotice = persistedArtifact.progressNotice?.trim();
    if (progressNotice) {
      await this.publishProgress(input.request, new ResearchRunEvidence(input.request.available_context.public_source_facts), { message: progressNotice, evidence_fact_ids: [] }, input.callbacks);
    }
    return persistedArtifact;
  }

  private loadPromptArtifact(
    sessionIdentity: string
  ): PersistedPromptRefinementArtifact | null {
    const row = this.store.forumResearchPromptArtifacts.get(sessionIdentity);
    if (!row) {
      return null;
    }

    appendRuntimeTrace("codex-app-server", "forum_prompt_artifact_loaded", {
      sessionIdentity,
      threadId: row.thread_id
    });
    return {
      sessionIdentity: row.session_identity,
      threadId: row.thread_id,
      lastMessageId: row.last_message_id,
      refinedPrompt: row.refined_prompt,
      progressNotice: row.progress_notice,
      promptRationaleSummary: row.prompt_rationale_summary
    };
  }
}

export function shouldRefreshForumPromptArtifact(request: HarnessRequest): boolean {
  return (
    request.available_context.place_context.features.includes("forum_research") &&
    request.place.thread_id !== null &&
    request.available_context.delivery_context.is_bot_directed
  );
}

function buildForumResearchBundle(input: {
  evidence: ResearchRunEvidence;
  currentPackets: ForumResearchWorkerPacket[];
}): ForumResearchBundle {
  const sourceCatalog = input.evidence.catalog(input.currentPackets);
  return {
    evidenceItems: dedupeEvidenceItems(input.currentPackets.flatMap(packet => packet.evidence_items)),
    currentWorkerPackets: input.currentPackets,
    distinctSourceTarget: FORUM_RESEARCH_DISTINCT_SOURCE_TARGET,
    distinctSources: sourceCatalog.map(entry => entry.url),
    sourceCatalog,
    publicSourceFacts: input.evidence.facts,
    publicSourceFailures: input.evidence.failures
  };
}

function persistCurrentResearchState(input: {
  store: SqliteStore;
  sessionIdentity: string;
  threadId: string;
  lastMessageId: string;
  previousState: PersistedForumResearchState | null;
  bundle: ForumResearchBundle;
}): void {
  const sources = new Map((input.previousState?.sourceCatalog ?? []).map(entry => [entry.url, entry]));
  for (const source of input.bundle.sourceCatalog) sources.set(source.url, source);
  input.store.forumResearchStates.upsert({
    sessionIdentity: input.sessionIdentity, threadId: input.threadId,
    lastMessageId: input.lastMessageId,
    evidenceItemsJson: JSON.stringify(dedupeEvidenceItems([...(input.previousState?.evidenceItems ?? []), ...input.bundle.evidenceItems])),
    sourceCatalogJson: JSON.stringify([...sources.values()]),
    distinctSourcesJson: JSON.stringify([...sources.keys()])
  });
}

function persistPromptArtifact(input: {
  store: SqliteStore;
  sessionIdentity: string;
  threadId: string;
  lastMessageId: string;
  artifact: {
    refined_prompt: string;
    progress_notice: string | null;
    prompt_rationale_summary: string | null;
  };
}): PersistedPromptRefinementArtifact {
  const nextArtifact: PersistedPromptRefinementArtifact = {
    sessionIdentity: input.sessionIdentity,
    threadId: input.threadId,
    lastMessageId: input.lastMessageId,
    refinedPrompt: input.artifact.refined_prompt.trim(),
    progressNotice: input.artifact.progress_notice?.trim() ?? null,
    promptRationaleSummary: input.artifact.prompt_rationale_summary?.trim() ?? null
  };
  input.store.forumResearchPromptArtifacts.upsert({
    sessionIdentity: nextArtifact.sessionIdentity,
    threadId: nextArtifact.threadId,
    lastMessageId: nextArtifact.lastMessageId,
    refinedPrompt: nextArtifact.refinedPrompt,
    progressNotice: nextArtifact.progressNotice,
    promptRationaleSummary: nextArtifact.promptRationaleSummary
  });
  appendRuntimeTrace("codex-app-server", "forum_prompt_artifact_saved", {
    sessionIdentity: nextArtifact.sessionIdentity,
    threadId: nextArtifact.threadId
  });
  return nextArtifact;
}

function buildStreamingFinalPayload(
  request: HarnessRequest,
  state: ForumResearchPipelineState,
  retryKind:
    | "initial"
    | "output_safety_retry"
    | Exclude<ForumVisibleRecoveryReason, "output_safety_regeneration">
): Record<string, unknown> {
  if (state.mode === "single") {
    return {
      kind: "forum_research_streaming_final",
      request: { ...request, available_context: { ...request.available_context, public_source_failures: state.evidence.failures } },
      forum_research_context: {
        execution_mode: "single", retry_kind: retryKind,
        starter_message: state.starterMessage ?? null,
        previous_research_state: state.persistedState,
        source_catalog: state.evidence.catalog([])
      }
    };
  }
  return {
    kind: "forum_research_streaming_final",
    request: { ...request, available_context: { ...request.available_context, public_source_failures: state.evidence.failures } },
    forum_research_context: {
      retry_kind: retryKind,
      distinct_source_target: state.bundle.distinctSourceTarget,
      refined_prompt: state.promptArtifact?.refinedPrompt,
      prompt_rationale_summary: state.promptArtifact?.promptRationaleSummary,
      final_brief: state.finalBrief,
      current_worker_packets: state.bundle.currentWorkerPackets,
      previous_research_state: state.persistedState,
      source_catalog: state.evidence.catalog(state.bundle.currentWorkerPackets),
      synthesis_contract: {
        use_worker_packets_as_coverage_map: true,
        preserve_cross_worker_findings: true,
        answer_may_span_multiple_discord_chunks: true
      }
    }
  };
}

function buildStreamingRetryPayload(
  request: HarnessRequest,
  state: ForumResearchPipelineState,
  reason: Exclude<ForumVisibleRecoveryReason, "output_safety_regeneration">
): Record<string, unknown> {
  return buildStreamingFinalPayload(request, state, reason);
}

function synthesizeStreamingResponse(
  text: string | null,
  sourceCatalog: ForumResearchSourceCatalogEntry[],
  note: string
): HarnessResponse {
  const publicText = text?.trim() ?? "";
  if (!publicText) throw new SyntaxError("forum synthesis produced no visible text");
  const compiled = compileForumCitations(publicText, sourceCatalog);
  return {
    outcome: "chat_reply", repo_write_intent: false,
    public_text: compiled.text, reply_mode: "same_place", target_thread_id: null,
    selected_source_ids: [], sources_used: compiled.sourcesUsed,
    knowledge_writes: [], diagnostics: { notes: note }, sensitivity_raise: "none"
  };
}

function dedupeEvidenceItems(
  evidenceItems: ForumResearchEvidenceItem[]
): ForumResearchEvidenceItem[] {
  const byKey = new Map<string, ForumResearchEvidenceItem>();
  for (const item of evidenceItems) {
    const normalizedUrls = dedupeStrings(
      item.source_urls
        .map((url) => normalizePublicUrl(url))
        .filter((url): url is string => Boolean(url))
    );
    if (normalizedUrls.length === 0) {
      continue;
    }
    const key = `${item.claim}\n${normalizedUrls.join("\n")}`;
    if (byKey.has(key)) {
      continue;
    }
    byKey.set(key, {
      ...item,
      claim: item.claim,
      source_urls: normalizedUrls
    });
  }
  return [...byKey.values()];
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

function mergeSourceCatalogObservations(
  observations: TurnObservations,
  evidence: ResearchRunEvidence
): TurnObservations {
  evidence.record({ facts: observations.public_source_facts ?? [], failures: observations.public_source_failures ?? [] });
  return {
    observed_public_urls: dedupeStrings([
      ...observations.observed_public_urls,
      ...evidence.facts.flatMap(fact => [fact.canonical_item_url, fact.observed_url])
    ]),
    generated_images: observations.generated_images,
    public_source_facts: evidence.facts,
    public_source_failures: evidence.failures
  };
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

export function parseEvidenceItems(
  value: string,
  sourceCatalog: ForumResearchSourceCatalogEntry[] = []
): ForumResearchEvidenceItem[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const parsedItems = parsed
      .map((item) => {
        if (item && typeof item === "object" && typeof item.claim === "string" && Array.isArray(item.source_urls)) {
          return { success: true as const, data: { claim: item.claim, source_urls: item.source_urls.filter((url: unknown): url is string => typeof url === "string"), evidence_fact_ids: [] } };
        }
        return forumResearchEvidenceItemSchema.safeParse(item);
      })
      .filter((item) => item.success)
      .map((item) => item.data);
    if (parsedItems.length > 0) {
      return parsedItems;
    }

    return parseLegacyEvidenceItems(parsed, sourceCatalog);
  } catch {
    return [];
  }
}

export function parseSourceCatalog(value: string): ForumResearchSourceCatalogEntry[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item): ForumResearchSourceCatalogEntry | null => {
        if (
          typeof item !== "object" ||
          item === null ||
          typeof item.url !== "string"
        ) {
          return null;
        }
        const index = typeof item.index === "number" ? item.index : 1;
        const claims = Array.isArray(item.claims)
          ? item.claims.filter(
              (claim: unknown): claim is string => typeof claim === "string"
            )
          : ["Legacy forum research progress"];
        return {
          index,
          source_id: "source_id" in item && typeof item.source_id === "string" ? item.source_id : `history:${index}`,
          evidence_fact_ids: [],
          url: item.url,
          claims
        } satisfies ForumResearchSourceCatalogEntry;
      })
      .filter((item): item is ForumResearchSourceCatalogEntry => item !== null);
  } catch {
    return [];
  }
}

function parseLegacyEvidenceItems(
  parsed: unknown[],
  sourceCatalog: ForumResearchSourceCatalogEntry[]
): ForumResearchEvidenceItem[] {
  const firstSource = sourceCatalog.find((source) => source.url.trim().length > 0);
  if (!firstSource) {
    return [];
  }

  return parsed
    .map((item): ForumResearchEvidenceItem | null => {
      if (
        typeof item !== "object" ||
        item === null ||
        (item as { kind?: unknown }).kind !== "legacy_forum_research_progress"
      ) {
        return null;
      }
      const plannerBrief = (item as { planner_brief?: unknown }).planner_brief;
      return {
        claim:
          typeof plannerBrief === "string" && plannerBrief.trim().length > 0
            ? plannerBrief.trim()
            : "Legacy forum research progress",
        source_urls: [firstSource.url],
        evidence_fact_ids: []
      };
    })
    .filter((item): item is ForumResearchEvidenceItem => item !== null);
}

function classifyWorkerFailure(
  error: unknown,
  interruptRequested: boolean
): "failed" | "interrupted" {
  if (interruptRequested) {
    return "interrupted";
  }
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /interrupt|aborted|cancel/i.test(message) ? "interrupted" : "failed";
}

function buildForumTerminalFailureResponse(
  publicText: string,
  note: string
): HarnessResponse {
  return {
    outcome: "failure",
    repo_write_intent: false,
    public_text: publicText,
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [],
    knowledge_writes: [],
    diagnostics: {
      notes: note
    },
    sensitivity_raise: "none"
  };
}

function buildVisibleRetryStatus(reason: ForumVisibleRecoveryReason): string {
  switch (reason) {
    case "output_safety_regeneration":
      return "公開可能な根拠だけで答え直しています。少し待ってください。";
    case "final_turn_protocol_error":
      return "再試行しています。生成結果の受け取りで問題が起きたため、整理し直しています。";
    case "final_turn_timeout":
      return "再試行しています。集まっている根拠をもとに整理し直しています。";
  }
}

function classifyRecoverableFinalTurnError(
  error: unknown
): Exclude<ForumVisibleRecoveryReason, "output_safety_regeneration"> | null {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const lowered = message.toLowerCase();
  if (lowered.includes("timeout") || lowered.includes("timed out")) {
    return "final_turn_timeout";
  }
  if (
    error instanceof SyntaxError ||
    lowered.includes("did not contain an agent message") ||
    lowered.includes("no visible text") ||
    lowered.includes("json") ||
    lowered.includes("unexpected token") ||
    lowered.includes("unterminated")
  ) {
    return "final_turn_protocol_error";
  }
  return null;
}

export const __testOnlyForumResearchPipeline = {
  buildStreamingFinalPayload
};
