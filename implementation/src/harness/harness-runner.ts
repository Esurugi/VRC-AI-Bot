import type { Logger } from "pino";

import type { SessionManager } from "../codex/session-manager.js";
import {
  SessionPolicyResolver,
  resolveScopedPlaceId,
  type ResolvedSessionIdentity
} from "../codex/session-policy.js";
import type { CodexAppServerClient } from "../codex/app-server-client.js";
import type {
  ActorRole,
  MessageEnvelope,
  Scope,
  WatchLocationConfig
} from "../domain/types.js";
import { KnowledgePersistenceService } from "../knowledge/knowledge-persistence-service.js";
import {
  DEFAULT_OVERRIDE_FLAGS,
  type OverrideContext
} from "../override/types.js";
import type { SqliteStore } from "../storage/database.js";
import { appendRuntimeTrace } from "../observability/runtime-trace.js";
import { buildHarnessRequest } from "./build-harness-request.js";
import { resolveHarnessCapabilities } from "./capability-resolver.js";
import type {
  HarnessIntentResponse,
  HarnessRequest,
  HarnessResponse,
  ThreadContextKind
} from "./contracts.js";
import { OutputSafetyGuard } from "./output-safety-guard.js";

export type HarnessMessageContext = {
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
  actorRole: ActorRole;
  scope: Scope;
  discordRuntimeFactsPath?: string | null;
};

type KnowledgeThreadEntry = {
  sourceId: string;
  sourceMessageId: string;
  title: string;
  summary: string;
  tags: string[];
  scope: Scope;
  recency: string;
  canonicalUrl: string;
};

type ResolvedThreadContext = {
  kind: ThreadContextKind;
  sourceMessageId: string | null;
  knownSourceUrls: string[];
  replyThreadId: string | null;
  rootChannelId: string;
  knowledgeEntries: KnowledgeThreadEntry[];
};

export type HarnessResolvedSession = {
  identity: ResolvedSessionIdentity;
  threadId: string;
  startedFresh: boolean;
};

export class HarnessRunner {
  private readonly knowledgePersistence: KnowledgePersistenceService;
  private readonly outputSafetyGuard: OutputSafetyGuard;

  constructor(
    private readonly store: SqliteStore,
    private readonly codexClient: CodexAppServerClient,
    private readonly sessionPolicyResolver: SessionPolicyResolver,
    private readonly sessionManager: SessionManager,
    private readonly logger: Logger
  ) {
    this.knowledgePersistence = new KnowledgePersistenceService(store, logger);
    this.outputSafetyGuard = new OutputSafetyGuard(store);
  }

  async routeMessage(input: HarnessMessageContext): Promise<{
    response: HarnessResponse;
    session: HarnessResolvedSession;
    knowledgePersistenceScope: Scope | null;
    moderationSignal: HarnessIntentResponse["moderation_signal"];
    violationCounterSuspended: boolean;
  }> {
    const normalizedInput = {
      ...input,
      envelope: normalizeEnvelope(input.envelope)
    };
    const threadContext = this.buildThreadContext(
      normalizedInput.envelope,
      normalizedInput.watchLocation
    );
    const overrideContext = this.buildOverrideContext(input);
    const workspaceWriteActive = canUseWorkspaceWrite(input, overrideContext);
    const intentRequest = buildHarnessRequest({
      actorRole: normalizedInput.actorRole,
      scope: normalizedInput.scope,
      watchLocation: normalizedInput.watchLocation,
      envelope: normalizedInput.envelope,
      taskKind: "route_message",
      taskPhase: "intent",
      overrideContext,
      threadContext,
      allowExternalFetch: false,
      allowKnowledgeWrite: false,
      allowModeration: normalizedInput.actorRole !== "user",
      discordRuntimeFactsPath: normalizedInput.discordRuntimeFactsPath ?? null
    });
    const fetchablePublicUrlCount =
      intentRequest.available_context.fetchable_public_urls.length;
    const sessionIdentity = this.sessionPolicyResolver.resolveForMessage({
      envelope: normalizedInput.envelope,
      watchLocation: normalizedInput.watchLocation,
      actorRole: normalizedInput.actorRole,
      scope: normalizedInput.scope,
      workspaceWriteActive
    });
    const session = await this.sessionManager.getOrStartSession(sessionIdentity);
    const resolvedSession: HarnessResolvedSession = {
      identity: sessionIdentity,
      threadId: session.threadId,
      startedFresh: session.startedFresh
    };
    this.logger.debug(
      {
        messageId: normalizedInput.envelope.messageId,
        placeMode: normalizedInput.watchLocation.mode,
        threadKind: threadContext.kind,
        workspaceWriteActive,
        sessionIdentity: sessionIdentity.sessionIdentity,
        workloadKind: sessionIdentity.workloadKind,
        sandboxMode: sessionIdentity.sandboxMode,
        runtimeContractVersion: sessionIdentity.runtimeContractVersion,
        allowExternalFetch: intentRequest.capabilities.allow_external_fetch,
        allowKnowledgeWrite: intentRequest.capabilities.allow_knowledge_write
      },
      "routing discord message through harness"
    );

    const intent = await this.codexClient.runHarnessIntentRequest(
      resolvedSession.threadId,
      intentRequest,
      toSessionMetadata(resolvedSession)
    );
    if (intent.repo_write_intent && !workspaceWriteActive) {
      return {
        response: buildOverrideRequiredResponse(normalizedInput),
        session: resolvedSession,
        knowledgePersistenceScope: null,
        moderationSignal: intent.moderation_signal,
        violationCounterSuspended: Boolean(
          overrideContext.active &&
            overrideContext.sameActor &&
            overrideContext.flags.suspendViolationCounterForCurrentThread
        )
      };
    }

    const grantedCapabilities = resolveHarnessCapabilities({
      actorRole: normalizedInput.actorRole,
      request: intentRequest,
      intent,
      workspaceWriteActive
    });
    const answerRequest = buildHarnessRequest({
      actorRole: normalizedInput.actorRole,
      scope: normalizedInput.scope,
      watchLocation: normalizedInput.watchLocation,
      envelope: normalizedInput.envelope,
      taskKind: "route_message",
      taskPhase: "answer",
      overrideContext,
      threadContext,
      allowExternalFetch: grantedCapabilities.allow_external_fetch,
      allowKnowledgeWrite: grantedCapabilities.allow_knowledge_write,
      allowModeration: grantedCapabilities.allow_moderation,
      discordRuntimeFactsPath: normalizedInput.discordRuntimeFactsPath ?? null
    });
    const normalizedResponse = await this.runAnswerFlow({
      input: normalizedInput,
      threadContext,
      request: answerRequest,
      session: resolvedSession,
      fetchablePublicUrlCount
    });

    this.logger.debug(
      {
        messageId: input.envelope.messageId,
        codexThreadId: resolvedSession.threadId,
        sessionIdentity: sessionIdentity.sessionIdentity,
        workloadKind: sessionIdentity.workloadKind,
        outcome: normalizedResponse.outcome,
        replyMode: normalizedResponse.reply_mode,
        hasPublicText: Boolean(normalizedResponse.public_text?.trim())
      },
      "harness produced response"
    );

    return {
      response: normalizedResponse,
      session: resolvedSession,
      knowledgePersistenceScope: resolveKnowledgePersistenceScope(
        normalizedInput.scope,
        normalizedInput.watchLocation,
        threadContext,
        normalizedResponse,
        fetchablePublicUrlCount
      ),
      moderationSignal: intent.moderation_signal,
      violationCounterSuspended: Boolean(
        overrideContext.active &&
          overrideContext.sameActor &&
          overrideContext.flags.suspendViolationCounterForCurrentThread
      )
    };
  }

  private async runAnswerFlow(input: {
    input: HarnessMessageContext;
    threadContext: ResolvedThreadContext;
    request: HarnessRequest;
    session: HarnessResolvedSession;
    fetchablePublicUrlCount: number;
  }): Promise<HarnessResponse> {
    const linkedKnowledgeSources = input.threadContext.knowledgeEntries.map((entry) => ({
      sourceId: entry.sourceId,
      scope: entry.scope,
      canonicalUrl: entry.canonicalUrl
    }));
    const firstTurn = await this.codexClient.runHarnessRequest(
      input.session.threadId,
      input.request,
      toSessionMetadata(input.session)
    );
    let response = normalizeProductResponse(
      input.input,
      input.threadContext,
      firstTurn.response,
      {
        fetchablePublicUrlCount: input.fetchablePublicUrlCount
      }
    );
    let observations = firstTurn.observations;

    if (shouldRetryKnowledgeThreadFollowUp(input.input, input.threadContext, response)) {
      const knowledgeRetryRequest = buildHarnessRequest({
        actorRole: input.input.actorRole,
        scope: input.input.scope,
        watchLocation: input.input.watchLocation,
        envelope: input.input.envelope,
        taskKind: input.request.task.kind,
        taskPhase: "retry",
        retryContext: {
          kind: "knowledge_followup_non_silent",
          retryCount: 1
        },
        threadContext: input.threadContext,
        allowExternalFetch: input.request.capabilities.allow_external_fetch,
        allowKnowledgeWrite: input.request.capabilities.allow_knowledge_write,
        allowModeration: input.request.capabilities.allow_moderation,
        overrideContext: {
          active: input.request.override_context.active,
          sameActor: input.request.override_context.same_actor,
          startedBy: input.request.override_context.started_by,
          startedAt: input.request.override_context.started_at,
          flags: {
            allowPlaywrightHeaded:
              input.request.override_context.flags.allow_playwright_headed,
            allowPlaywrightPersistent:
              input.request.override_context.flags.allow_playwright_persistent,
            allowPromptInjectionTest:
              input.request.override_context.flags.allow_prompt_injection_test,
            suspendViolationCounterForCurrentThread:
              input.request.override_context.flags
                .suspend_violation_counter_for_current_thread,
            allowExternalFetchInPrivateContextWithoutPrivateTerms:
              input.request.override_context.flags
                .allow_external_fetch_in_private_context_without_private_terms
          }
        },
        discordRuntimeFactsPath:
          input.request.available_context.discord_runtime_facts_path
      });
      const knowledgeRetryTurn = await this.codexClient.runHarnessRequest(
        input.session.threadId,
        knowledgeRetryRequest,
        toSessionMetadata(input.session)
      );
      response = normalizeProductResponse(
        input.input,
        input.threadContext,
        knowledgeRetryTurn.response,
        {
          fetchablePublicUrlCount: input.fetchablePublicUrlCount
        }
      );
      observations = knowledgeRetryTurn.observations;
      if (shouldRetryKnowledgeThreadFollowUp(input.input, input.threadContext, response)) {
        return buildKnowledgeThreadFailure(input.input);
      }
    }

    const firstEvaluation = this.outputSafetyGuard.evaluate({
      request: input.request,
      response,
      linkedKnowledgeSources,
      observedPublicUrls: observations.observed_public_urls,
      retryCount: 0
    });
    this.traceOutputSafetyDecision(
      input.input,
      input.session,
      firstEvaluation,
      0
    );
    if (firstEvaluation.decision === "allow") {
      return response;
    }

    if (firstEvaluation.decision === "refuse") {
      return buildOutputSafetyRefusal(input.input, firstEvaluation.reason);
    }

    const retryRequest = buildHarnessRequest({
      actorRole: input.input.actorRole,
      scope: input.input.scope,
      watchLocation: input.input.watchLocation,
      envelope: input.input.envelope,
      taskKind: input.request.task.kind,
      taskPhase: "retry",
      retryContext: {
        kind: "output_safety",
        retryCount: 1,
        reason: firstEvaluation.reason ?? "unsafe source boundary",
        allowedSources: firstEvaluation.allowedSources,
        disallowedSources: firstEvaluation.disallowedSources
      },
      threadContext: input.threadContext,
      allowExternalFetch: input.request.capabilities.allow_external_fetch,
      allowKnowledgeWrite: input.request.capabilities.allow_knowledge_write,
      allowModeration: input.request.capabilities.allow_moderation,
      overrideContext: {
        active: input.request.override_context.active,
        sameActor: input.request.override_context.same_actor,
        startedBy: input.request.override_context.started_by,
        startedAt: input.request.override_context.started_at,
        flags: {
          allowPlaywrightHeaded:
            input.request.override_context.flags.allow_playwright_headed,
          allowPlaywrightPersistent:
            input.request.override_context.flags.allow_playwright_persistent,
          allowPromptInjectionTest:
            input.request.override_context.flags.allow_prompt_injection_test,
          suspendViolationCounterForCurrentThread:
            input.request.override_context.flags
              .suspend_violation_counter_for_current_thread,
          allowExternalFetchInPrivateContextWithoutPrivateTerms:
            input.request.override_context.flags
              .allow_external_fetch_in_private_context_without_private_terms
        }
      },
      discordRuntimeFactsPath:
        input.request.available_context.discord_runtime_facts_path
    });
    const secondTurn = await this.codexClient.runHarnessRequest(
      input.session.threadId,
      retryRequest,
      toSessionMetadata(input.session)
    );
    const secondPass = normalizeProductResponse(
      input.input,
      input.threadContext,
      secondTurn.response,
      {
        fetchablePublicUrlCount: input.fetchablePublicUrlCount
      }
    );
    const secondEvaluation = this.outputSafetyGuard.evaluate({
      request: retryRequest,
      response: secondPass,
      linkedKnowledgeSources,
      observedPublicUrls: secondTurn.observations.observed_public_urls,
      retryCount: 1
    });
    this.traceOutputSafetyDecision(
      input.input,
      input.session,
      secondEvaluation,
      1
    );
    if (secondEvaluation.decision === "allow") {
      if (shouldRetryKnowledgeThreadFollowUp(input.input, input.threadContext, secondPass)) {
        return buildKnowledgeThreadFailure(input.input);
      }
      return secondPass;
    }

    return buildOutputSafetyRefusal(input.input, secondEvaluation.reason);
  }

  private traceOutputSafetyDecision(
    input: HarnessMessageContext,
    session: HarnessResolvedSession,
    evaluation: ReturnType<OutputSafetyGuard["evaluate"]>,
    retryCount: number
  ): void {
    const payload = {
      messageId: input.envelope.messageId,
      sessionIdentity: session.identity.sessionIdentity,
      workloadKind: session.identity.workloadKind,
      runtimeContractVersion: session.identity.runtimeContractVersion,
      retryCount,
      decision: evaluation.decision,
      reason: evaluation.reason,
      allowedSources: evaluation.allowedSources,
      disallowedSources: evaluation.disallowedSources
    };
    this.logger.debug(payload, "evaluated output safety");
    appendRuntimeTrace("codex-app-server", "output_safety_evaluated", payload);
  }

  persistKnowledgeResult(input: HarnessMessageContext & {
    response: HarnessResponse;
    replyThreadId: string | null;
    persistenceScope: Scope;
  }): void {
    try {
      this.knowledgePersistence.persist({
        response: input.response,
        sourceUrls: input.envelope.urls,
        guildId: input.envelope.guildId,
        rootChannelId: input.watchLocation.channelId,
        placeId: resolveScopedPlaceId({
          envelope: input.envelope,
          watchLocation: input.watchLocation
        }),
        scope: input.persistenceScope,
        sourceMessageId: input.envelope.messageId,
        replyThreadId: input.replyThreadId
      });
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: input.envelope.messageId,
          persistenceScope: input.persistenceScope,
          replyThreadId: input.replyThreadId
        },
        "knowledge persistence failed; continuing with reply"
      );
    }
  }

  private buildOverrideContext(input: HarnessMessageContext): OverrideContext {
    const active = this.store.overrideSessions.getActive(
      input.envelope.guildId,
      resolveScopedPlaceId({
        envelope: input.envelope,
        watchLocation: input.watchLocation
      }),
      input.envelope.authorId
    );

    if (!active) {
      return {
        active: false,
        sameActor: false,
        startedBy: null,
        startedAt: null,
        flags: DEFAULT_OVERRIDE_FLAGS
      };
    }

    return {
      active: true,
      sameActor: active.actorId === input.envelope.authorId,
      startedBy: active.grantedBy,
      startedAt: active.startedAt,
      flags: active.flags
    };
  }

  private buildThreadContext(
    envelope: MessageEnvelope,
    watchLocation: WatchLocationConfig
  ): ResolvedThreadContext {
    if (!envelope.placeType.endsWith("thread")) {
      return {
        kind: "root_channel",
        sourceMessageId: null,
        knownSourceUrls: [],
        replyThreadId: null,
        rootChannelId: watchLocation.channelId,
        knowledgeEntries: []
      };
    }

    const threadKnowledge = this.store.sourceLinks.listKnowledgeContextForReplyThread(
      envelope.channelId
    );
    if (threadKnowledge.length === 0) {
      return {
        kind: "plain_thread",
        sourceMessageId: null,
        knownSourceUrls: [],
        replyThreadId: envelope.channelId,
        rootChannelId: watchLocation.channelId,
        knowledgeEntries: []
      };
    }

    return {
      kind: "knowledge_thread",
      sourceMessageId: threadKnowledge[0]?.sourceMessageId ?? null,
      knownSourceUrls: threadKnowledge.map((candidate) => candidate.canonicalUrl),
      replyThreadId: envelope.channelId,
      rootChannelId: watchLocation.channelId,
      knowledgeEntries: threadKnowledge.map((candidate) => ({
        sourceId: candidate.sourceId,
        sourceMessageId: candidate.sourceMessageId,
        title: candidate.title,
        summary: candidate.summary,
        tags: candidate.tags,
        scope: candidate.scope,
        recency: candidate.recency,
        canonicalUrl: candidate.canonicalUrl
      }))
    };
  }
}

function canUseWorkspaceWrite(
  input: HarnessMessageContext,
  overrideContext: OverrideContext
): boolean {
  return (
    input.watchLocation.mode === "admin_control" &&
    input.envelope.placeType.endsWith("thread") &&
    input.actorRole !== "user" &&
    overrideContext.active &&
    overrideContext.sameActor
  );
}

function buildOverrideRequiredResponse(input: HarnessMessageContext): HarnessResponse {
  const locationHint =
    input.watchLocation.mode === "admin_control"
      ? input.envelope.placeType.endsWith("thread")
        ? "この要求を実行するには、この override thread を開いた管理者が active override を維持している必要があります。"
        : "この要求を実行するには、configured `admin_control` root channel で `/override-start` を実行して dedicated override thread を開いてください。"
      : "この要求は admin_control root channel で `/override-start` を実行した管理者だけが、開かれた dedicated override thread 内で扱えます。";

  return {
    outcome: "chat_reply",
    repo_write_intent: false,
    public_text: `${locationHint} 終了時は override thread 内で \`/override-end\` を使って thread と write session を閉じてください。`,
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [],
    knowledge_writes: [],
    diagnostics: {
      notes: "repo write intent denied without active override"
    },
    sensitivity_raise: "none"
  };
}

function buildOutputSafetyRefusal(
  input: HarnessMessageContext,
  reason: string | null
): HarnessResponse {
  return {
    outcome: "failure",
    repo_write_intent: false,
    public_text:
      "この返信は出典の公開範囲を安全に満たせなかったため、そのままは返せませんでした。公開可能な根拠を指定して、もう一度聞いてください。",
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [],
    knowledge_writes: [],
    diagnostics: {
      notes:
        reason === null
          ? "output safety refusal"
          : `output safety refusal: ${reason}`
    },
    sensitivity_raise: input.scope === "conversation_only" ? "conversation_only" : "none"
  };
}

function normalizeEnvelope(envelope: MessageEnvelope): MessageEnvelope {
  if (envelope.content.trim().length > 0 || envelope.urls.length === 0) {
    return envelope;
  }

  return {
    ...envelope,
    content: envelope.urls.join("\n")
  };
}

function normalizeProductResponse(
  input: HarnessMessageContext,
  threadContext: ResolvedThreadContext,
  response: HarnessResponse,
  policy: {
    fetchablePublicUrlCount: number;
  }
): HarnessResponse {
  const baseResponse = normalizeKnowledgeIngestResponse(
    input,
    threadContext,
    response,
    policy
  );
  const dedupedResponse = {
    ...baseResponse,
    selected_source_ids: dedupeStrings(baseResponse.selected_source_ids),
    sources_used: dedupeStrings(baseResponse.sources_used),
    knowledge_writes: dedupeKnowledgeWrites(baseResponse.knowledge_writes)
  };

  return dedupedResponse;
}

function normalizeKnowledgeIngestResponse(
  input: HarnessMessageContext,
  threadContext: ResolvedThreadContext,
  response: HarnessResponse,
  policy: {
    fetchablePublicUrlCount: number;
  }
): HarnessResponse {
  if (response.outcome !== "knowledge_ingest") {
    return response;
  }

  const shouldCreatePublicThread =
    input.watchLocation.mode === "url_watch" &&
    threadContext.kind === "root_channel" &&
    policy.fetchablePublicUrlCount > 0;

  return {
    ...response,
    public_text:
      response.public_text?.trim() || buildKnowledgeReplyText(response),
    reply_mode: shouldCreatePublicThread ? "create_public_thread" : "same_place",
    target_thread_id:
      shouldCreatePublicThread || !input.envelope.placeType.endsWith("thread")
        ? null
        : input.envelope.channelId
  };
}

function resolveKnowledgePersistenceScope(
  currentScope: Scope,
  watchLocation: WatchLocationConfig,
  threadContext: ResolvedThreadContext,
  response: HarnessResponse,
  fetchablePublicUrlCount: number
): Scope | null {
  if (response.outcome !== "knowledge_ingest") {
    return null;
  }

  if (
    watchLocation.mode === "url_watch" &&
    threadContext.kind === "root_channel" &&
    fetchablePublicUrlCount > 0
  ) {
    return currentScope;
  }

  if (threadContext.kind === "knowledge_thread" && fetchablePublicUrlCount > 0) {
    return currentScope;
  }

  return "server_public";
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

function dedupeKnowledgeWrites(
  values: HarnessResponse["knowledge_writes"]
): HarnessResponse["knowledge_writes"] {
  const seen = new Set<string>();
  const deduped: HarnessResponse["knowledge_writes"] = [];

  for (const value of values) {
    const key = value.canonical_url ?? value.source_url ?? JSON.stringify(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

function wouldProduceVisibleReply(response: HarnessResponse): boolean {
  switch (response.outcome) {
    case "ignore":
      return false;
    case "admin_diagnostics":
      return true;
    case "knowledge_ingest":
      return true;
    case "chat_reply":
      return (
        response.reply_mode !== "no_reply" &&
        Boolean(response.public_text?.trim())
      );
    case "failure":
      return Boolean(response.public_text?.trim());
  }
}

function buildKnowledgeThreadFailure(input: HarnessMessageContext): HarnessResponse {
  return {
    outcome: "failure",
    repo_write_intent: false,
    public_text:
      "このスレッドへの追撃応答を生成できませんでした。必要なら同じ依頼をもう一度送ってください。",
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [],
    knowledge_writes: [],
    diagnostics: {
      notes: `knowledge thread follow-up produced no visible reply in ${input.watchLocation.mode}`
    },
    sensitivity_raise: input.scope === "conversation_only" ? "conversation_only" : "none"
  };
}

function shouldRetryKnowledgeThreadFollowUp(
  input: HarnessMessageContext,
  threadContext: ResolvedThreadContext,
  response: HarnessResponse
): boolean {
  return (
    threadContext.kind === "knowledge_thread" &&
    input.envelope.content.trim().length > 0 &&
    !wouldProduceVisibleReply(response)
  );
}

function toSessionMetadata(
  session: HarnessResolvedSession
): {
  sessionIdentity: string;
  workloadKind: string;
  modelProfile: string;
  runtimeContractVersion: string;
} {
  return {
    sessionIdentity: session.identity.sessionIdentity,
    workloadKind: session.identity.workloadKind,
    modelProfile: session.identity.modelProfile,
    runtimeContractVersion: session.identity.runtimeContractVersion
  };
}

export function buildKnowledgeReplyText(response: HarnessResponse): string {
  const direct = response.public_text?.trim();
  if (direct) {
    return direct;
  }

  const summaries = response.knowledge_writes
    .map((item) => {
      const title = item.title ?? item.canonical_url ?? item.source_url ?? "source";
      const summary = item.summary ?? "";
      const tags = item.tags.length > 0 ? `\nタグ: ${item.tags.join(", ")}` : "";
      return `【${title}】\n${summary}${tags}`.trim();
    })
    .filter((entry) => entry.length > 0);

  if (summaries.length > 0) {
    return summaries.join("\n\n");
  }

  return "リンクを確認しましたが、共有用の要約を生成できませんでした。";
}
