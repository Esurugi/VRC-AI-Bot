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
  forumResearchEvidenceItemSchema,
  forumResearchWorkerPacketJsonSchema,
  forumResearchWorkerPacketSchema,
  type ForumResearchBundle,
  type ForumResearchEvidenceItem,
  type ForumResearchSourceCatalogEntry,
  type ForumResearchSupervisorDecision,
  type ForumResearchWorkerCitation,
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
  bundle: ForumResearchBundle;
  persistedState: PersistedForumResearchState | null;
  promptArtifact: PersistedPromptRefinementArtifact;
  finalBrief: string | null;
};

export type ForumResearchRetryCallbacks = {
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

export class ForumResearchPipeline {
  constructor(
    private readonly store: SqliteStore,
    private readonly codexClient: CodexAppServerClient,
    private readonly promptRefiner: ForumResearchPromptRefiner,
    private readonly supervisor: ForumResearchSupervisor,
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
    await input.callbacks?.onProgressNotice?.(
      buildForumPhaseProgressNotice("prompt_refinement")
    );
    const promptArtifact = await this.loadOrCreatePromptArtifact({
      request: input.request,
      threadId: input.threadId,
      sessionIdentity: input.sessionMetadata.sessionIdentity,
      starterMessage: input.starterMessage ?? null,
      ...(input.callbacks ? { callbacks: input.callbacks } : {})
    });
    await input.callbacks?.onProgressNotice?.(
      buildForumPhaseProgressNotice("supervisor_planning")
    );
    const persistedState = this.loadPersistedState(input.sessionMetadata.sessionIdentity);
    const researchState = await this.collectResearchState({
      request: applyRefinedPrompt(input.request, promptArtifact.refinedPrompt),
      threadId: input.threadId,
      sessionMetadata: input.sessionMetadata,
      persistedState,
      promptArtifact,
      ...(input.callbacks ? { callbacks: input.callbacks } : {})
    });

    try {
      const result = await this.runFinalStreamingTurn({
        request: applyRefinedPrompt(input.request, researchState.promptArtifact.refinedPrompt),
        threadId: input.threadId,
        sessionMetadata: input.sessionMetadata,
        state: researchState,
        retryKind: "initial",
        ...(input.callbacks ? { callbacks: input.callbacks } : {})
      });
      return {
        ...result,
        state: researchState,
        primaryReplyAlreadySent: result.response.outcome === "chat_reply"
      };
    } catch (error) {
      const reason = classifyRecoverableFinalTurnError(error);
      if (!reason) {
        throw error;
      }

      const retried = await this.runVisibleStreamingRecovery({
        request: applyRefinedPrompt(input.request, researchState.promptArtifact.refinedPrompt),
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
        request: applyRefinedPrompt(input.request, input.state.promptArtifact.refinedPrompt),
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
          observed_public_urls: []
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
    const activeWorkers = new Map<string, ActiveWorker>();
    const launchedWorkerIds = new Set<string>();
    const progressNotices = new Set<string>();
    const workerHistory: WorkerHistory = {
      completed: [],
      failed: [],
      interrupted: []
    };
    let finalBrief: string | null = null;
    let persistedState = input.persistedState;
    let decision = await this.requestSupervisorDecision({
      request: input.request,
      threadId: input.threadId,
      promptArtifact: input.promptArtifact,
      activeWorkers,
      workerHistory,
      persistedState
    });

    while (true) {
      const appliedDecision = await this.applySupervisorDecision({
        request: input.request,
        decision,
        activeWorkers,
        launchedWorkerIds,
        workerHistory,
        finalBrief,
        ...(input.callbacks ? { callbacks: input.callbacks } : {}),
        progressNotices
      });
      finalBrief = appliedDecision.finalBrief;

      if (decision.next_action === "finalize" && activeWorkers.size === 0) {
        break;
      }

      if (activeWorkers.size === 0) {
        throw new Error("forum research supervisor did not provide runnable worker tasks");
      }

      while (activeWorkers.size > 0) {
        const outcome = await waitForNextWorker(activeWorkers);
        if (outcome.type === "completed") {
          workerHistory.completed.push(outcome.packet);
          persistedState = persistCurrentResearchState({
            store: this.store,
            sessionIdentity: input.sessionMetadata.sessionIdentity,
            threadId: input.threadId,
            lastMessageId: input.request.message.id,
            previousState: persistedState,
            completedPackets: workerHistory.completed
          });
          appendRuntimeTrace("codex-app-server", "forum_research_worker_completed", {
            messageId: input.request.message.id,
            workerId: outcome.task.worker_id,
            citationCount: outcome.packet.citations.length
          });
        } else if (outcome.type === "interrupted") {
          workerHistory.interrupted.push(outcome.task);
        } else {
          workerHistory.failed.push(outcome.task);
          this.logger.warn(
            {
              error:
                outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
              messageId: input.request.message.id,
              workerId: outcome.task.worker_id
            },
            "forum research worker failed"
          );
        }
      }

      decision = await this.requestSupervisorDecision({
        request: input.request,
        threadId: input.threadId,
        promptArtifact: input.promptArtifact,
        activeWorkers,
        workerHistory,
        persistedState
      });
    }

    const bundle = buildForumResearchBundle({
      previousState: persistedState,
      currentPackets: workerHistory.completed
    });

    return {
      bundle,
      persistedState,
      promptArtifact: input.promptArtifact,
      finalBrief
    };
  }

  private async requestSupervisorDecision(input: {
    request: HarnessRequest;
    threadId: string;
    promptArtifact: PersistedPromptRefinementArtifact;
    activeWorkers: Map<string, ActiveWorker>;
    workerHistory: WorkerHistory;
    persistedState: PersistedForumResearchState | null;
  }): Promise<ForumResearchSupervisorDecision> {
    const bundle = buildForumResearchBundle({
      previousState: input.persistedState,
      currentPackets: input.workerHistory.completed
    });
    const decision = await this.supervisor.decide({
      messageId: input.request.message.id,
      threadId: input.threadId,
      refinedPrompt: input.promptArtifact.refinedPrompt,
      activeWorkers: [
        ...[...input.activeWorkers.values()].map((worker) => ({
          worker_id: worker.task.worker_id,
          question: worker.task.question,
          search_focus: worker.task.search_focus,
          state: "running" as const
        })),
        ...input.workerHistory.failed.map((task) => ({
          worker_id: task.worker_id,
          question: task.question,
          search_focus: task.search_focus,
          state: "failed" as const
        })),
        ...input.workerHistory.interrupted.map((task) => ({
          worker_id: task.worker_id,
          question: task.question,
          search_focus: task.search_focus,
          state: "interrupted" as const
        }))
      ],
      completedWorkers: input.workerHistory.completed.map((packet) => ({
        worker_id: packet.worker_id,
        subquestion: packet.subquestion
      })),
      currentEvidenceItems: bundle.evidenceItems,
      currentSourceCatalog: bundle.sourceCatalog,
      previousResearchState: input.persistedState
    });

    appendRuntimeTrace("codex-app-server", "forum_research_supervisor_decided", {
      messageId: input.request.message.id,
      nextAction: decision.next_action,
      workerCount: decision.worker_tasks.length,
      interruptCount: decision.interrupts.length
    });
    return decision;
  }

  private async applySupervisorDecision(input: {
    request: HarnessRequest;
    decision: ForumResearchSupervisorDecision;
    activeWorkers: Map<string, ActiveWorker>;
    launchedWorkerIds: Set<string>;
    workerHistory: WorkerHistory;
    finalBrief: string | null;
    callbacks?: ForumResearchRetryCallbacks;
    progressNotices: Set<string>;
  }): Promise<{
    finalBrief: string | null;
  }> {
    const progressNotice = input.decision.progress_notice?.trim() ?? null;
    if (progressNotice && !input.progressNotices.has(progressNotice)) {
      input.progressNotices.add(progressNotice);
      await input.callbacks?.onProgressNotice?.(progressNotice);
    }

    const finalBrief = input.decision.final_brief?.trim() || input.finalBrief;

    if (
      input.activeWorkers.size + input.decision.worker_tasks.length >
      FORUM_RESEARCH_MAX_WORKERS
    ) {
      throw new Error("forum research supervisor exceeded the worker concurrency limit");
    }

    for (const workerId of input.decision.interrupts) {
      const active = input.activeWorkers.get(workerId);
      if (!active) {
        throw new Error(`forum research supervisor requested interrupt for inactive worker: ${workerId}`);
      }
      if (active.interruptRequested) {
        continue;
      }
      active.interruptRequested = true;
      await active.interrupt();
      appendRuntimeTrace("codex-app-server", "forum_research_worker_interrupted", {
        messageId: input.request.message.id,
        workerId
      });
    }

    if (input.decision.next_action === "finalize" && input.decision.worker_tasks.length > 0) {
      throw new Error("forum research supervisor returned worker tasks while finalizing");
    }
    if (
      input.decision.next_action === "launch_workers" &&
      input.decision.worker_tasks.length === 0
    ) {
      throw new Error("forum research supervisor requested launch_workers without worker tasks");
    }

    if (input.decision.next_action === "launch_workers") {
      const newWorkers = await Promise.all(
        input.decision.worker_tasks.map(async (task) => {
          if (
            input.launchedWorkerIds.has(task.worker_id) ||
            input.activeWorkers.has(task.worker_id) ||
            input.workerHistory.completed.some((packet) => packet.worker_id === task.worker_id) ||
            input.workerHistory.failed.some((failed) => failed.worker_id === task.worker_id) ||
            input.workerHistory.interrupted.some(
              (interrupted) => interrupted.worker_id === task.worker_id
            )
          ) {
            throw new Error(`forum research supervisor reused worker_id: ${task.worker_id}`);
          }

          const worker = await this.startWorker({
            request: input.request,
            task
          });
          return {
            task,
            worker
          };
        })
      );

      for (const entry of newWorkers) {
        input.launchedWorkerIds.add(entry.task.worker_id);
        input.activeWorkers.set(entry.task.worker_id, entry.worker);
      }
    }

    return {
      finalBrief
    };
  }

  private async startWorker(input: {
    request: HarnessRequest;
    task: ForumResearchWorkerTask;
  }): Promise<ActiveWorker> {
    const threadId = await this.codexClient.startEphemeralThread(
      "read-only",
      FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE
    );
    appendRuntimeTrace("codex-app-server", "forum_research_worker_started", {
      messageId: input.request.message.id,
      workerId: input.task.worker_id
    });

    const startedTurn = await this.codexClient.startJsonTurn({
      threadId,
      inputPayload: {
        kind: "forum_research_worker",
        place_mode: "forum_longform",
        request: {
          message_id: input.request.message.id,
          message_content: input.request.message.content,
          urls: input.request.message.urls,
          thread_id: input.request.place.thread_id,
          root_channel_id: input.request.place.root_channel_id
        },
        task: input.task
      },
      allowExternalFetch: true,
      outputSchema: forumResearchWorkerPacketJsonSchema,
      parser: (value) => forumResearchWorkerPacketSchema.parse(value),
      modelProfile: FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE
    });

    const activeWorker: ActiveWorker = {
      task: input.task,
      threadId,
      interruptRequested: false,
      interrupt: startedTurn.interrupt,
      completion: startedTurn.completion
        .then((result) => ({
          type: "completed" as const,
          task: input.task,
          packet: result.response
        }))
        .catch((error) => ({
          type: classifyWorkerFailure(error, activeWorker.interruptRequested),
          task: input.task,
          error
        }))
        .finally(async () => {
          await this.codexClient.closeEphemeralThread(threadId).catch(() => undefined);
        })
    };

    return activeWorker;
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
    await input.callbacks?.onProgressNotice?.(
      buildForumPhaseProgressNotice("final_synthesis")
    );
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
      modelProfile: FORUM_LONGFORM_CODEX_MODEL_PROFILE,
      callbacks: {
        onAgentMessageDelta: async (delta) => {
          await input.callbacks?.onFinalTextDelta?.(delta);
        }
      }
    });
    await input.callbacks?.onFinalTextCompleted?.();

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

    return {
      response: synthesizeStreamingResponse(
        result.response,
        input.state.bundle.sourceCatalog,
        result.observations.observed_public_urls,
        input.retryKind === "initial"
          ? "forum streaming final"
          : "forum output safety streaming final"
      ),
      observations: result.observations
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
        modelProfile: FORUM_LONGFORM_CODEX_MODEL_PROFILE,
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

      const response = synthesizeStreamingResponse(
        result.response,
        input.state.bundle.sourceCatalog,
        result.observations.observed_public_urls,
        "forum visible recovery streaming final"
      );

      return {
        response,
        observations: result.observations,
        primaryReplyAlreadySent: response.outcome === "chat_reply"
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
          observed_public_urls: []
        },
        primaryReplyAlreadySent: false
      };
    }
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
      evidenceItems: parseEvidenceItems(row.evidence_items_json),
      sourceCatalog: parseSourceCatalog(row.source_catalog_json),
      distinctSources: parseStringArray(row.distinct_sources_json)
    };
  }

  private async loadOrCreatePromptArtifact(input: {
    request: HarnessRequest;
    threadId: string;
    sessionIdentity: string;
    starterMessage: string | null;
    callbacks?: ForumResearchRetryCallbacks;
  }): Promise<PersistedPromptRefinementArtifact> {
    const existing = this.loadPromptArtifact(input.sessionIdentity);
    if (existing) {
      return existing;
    }

    const artifact = await this.promptRefiner.refine({
      messageId: input.request.message.id,
      currentMessage: input.request.message.content,
      starterMessage: input.starterMessage,
      threadId: input.threadId,
      threadContext: {
        kind: input.request.available_context.thread_context.kind,
        root_channel_id: input.request.available_context.thread_context.root_channel_id,
        reply_thread_id: input.request.available_context.thread_context.reply_thread_id,
        known_source_urls: input.request.available_context.thread_context.known_source_urls
      },
      fetchablePublicUrls: input.request.available_context.fetchable_public_urls
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
      await input.callbacks?.onProgressNotice?.(progressNotice);
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

async function waitForNextWorker(
  activeWorkers: Map<string, ActiveWorker>
): Promise<WorkerOutcome> {
  const pending = [...activeWorkers.values()].map((worker) =>
    worker.completion.then((outcome) => ({
      workerId: worker.task.worker_id,
      outcome
    }))
  );
  const settled = await Promise.race(pending);
  activeWorkers.delete(settled.workerId);
  return settled.outcome;
}

function applyRefinedPrompt(
  request: HarnessRequest,
  refinedPrompt: string | null
): HarnessRequest {
  const override = refinedPrompt?.trim();
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
  previousState: PersistedForumResearchState | null;
  currentPackets: ForumResearchWorkerPacket[];
}): ForumResearchBundle {
  const evidenceItems = dedupeEvidenceItems([
    ...(input.previousState?.evidenceItems ?? []),
    ...input.currentPackets.flatMap((packet) => packet.evidence_items)
  ]);
  const sourceCatalog = buildSourceCatalog(
    input.previousState?.sourceCatalog ?? [],
    input.currentPackets
  );
  return {
    evidenceItems,
    currentWorkerPackets: input.currentPackets,
    distinctSourceTarget: FORUM_RESEARCH_DISTINCT_SOURCE_TARGET,
    distinctSources: sourceCatalog.map((entry) => entry.url),
    sourceCatalog
  };
}

function buildSourceCatalog(
  priorCatalog: ForumResearchSourceCatalogEntry[],
  workerPackets: ForumResearchWorkerPacket[]
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
      claims: dedupeStrings(prior.claims)
    });
  }

  for (const packet of workerPackets) {
    for (const citation of packet.citations) {
      mergeCitation(byUrl, citation);
    }
    for (const evidenceItem of packet.evidence_items) {
      for (const sourceUrl of evidenceItem.source_urls) {
        mergeCitation(byUrl, {
          url: sourceUrl,
          claim: evidenceItem.claim
        });
      }
    }
  }

  return [...byUrl.values()].map((entry, index) => ({
    ...entry,
    index: index + 1,
    claims: dedupeStrings(entry.claims)
  }));
}

function mergeCitation(
  byUrl: Map<string, ForumResearchSourceCatalogEntry>,
  citation: ForumResearchWorkerCitation
): void {
  const canonicalUrl = normalizePublicUrl(citation.url);
  if (!canonicalUrl) {
    return;
  }

  const existing = byUrl.get(canonicalUrl);
  if (existing) {
    existing.claims.push(citation.claim);
    return;
  }

  byUrl.set(canonicalUrl, {
    index: 0,
    url: canonicalUrl,
    claims: [citation.claim]
  });
}

function persistCurrentResearchState(input: {
  store: SqliteStore;
  sessionIdentity: string;
  threadId: string;
  lastMessageId: string;
  previousState: PersistedForumResearchState | null;
  completedPackets: ForumResearchWorkerPacket[];
}): PersistedForumResearchState {
  const bundle = buildForumResearchBundle({
    previousState: input.previousState,
    currentPackets: input.completedPackets
  });
  const nextState: PersistedForumResearchState = {
    sessionIdentity: input.sessionIdentity,
    threadId: input.threadId,
    lastMessageId: input.lastMessageId,
    evidenceItems: bundle.evidenceItems,
    sourceCatalog: bundle.sourceCatalog,
    distinctSources: bundle.distinctSources
  };
  input.store.forumResearchStates.upsert({
    sessionIdentity: nextState.sessionIdentity,
    threadId: nextState.threadId,
    lastMessageId: nextState.lastMessageId,
    evidenceItemsJson: JSON.stringify(nextState.evidenceItems),
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
  return {
    kind: "forum_research_streaming_final",
    request,
    forum_research_context: {
      retry_kind: retryKind,
      distinct_source_target: state.bundle.distinctSourceTarget,
      refined_prompt: state.promptArtifact.refinedPrompt,
      prompt_rationale_summary: state.promptArtifact.promptRationaleSummary,
      final_brief: state.finalBrief,
      current_evidence_items: state.bundle.currentWorkerPackets.flatMap(
        (packet) => packet.evidence_items
      ),
      previous_research_state: state.persistedState,
      source_catalog: state.bundle.sourceCatalog
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
  observedPublicUrls: string[],
  note: string
): HarnessResponse {
  const publicText = text?.trim() ?? "";
  if (!publicText) {
    return buildForumTerminalFailureResponse(
      "調査回答の再試行は完了できませんでした。必要なら同じ thread で続けてください。",
      "forum timeout recovery produced no visible text"
    );
  }
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
    public_text: publicText,
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: sourcesUsed,
    knowledge_writes: [],
    diagnostics: {
      notes: note
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

function parseEvidenceItems(value: string): ForumResearchEvidenceItem[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .map((item) => forumResearchEvidenceItemSchema.safeParse(item))
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

function buildForumPhaseProgressNotice(
  phase: "prompt_refinement" | "supervisor_planning" | "final_synthesis"
): string {
  switch (phase) {
    case "prompt_refinement":
      return "依頼の焦点を整理しています。少し待ってください。";
    case "supervisor_planning":
      return "論点を分解して調査項目を組み立てています。";
    case "final_synthesis":
      return "集まった根拠を統合して回答を書いています。";
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
