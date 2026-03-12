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
import { isAllowedPublicHttpUrl } from "../playwright/url-policy.js";
import {
  DEFAULT_OVERRIDE_FLAGS,
  type OverrideContext
} from "../override/types.js";
import type { SqliteStore } from "../storage/database.js";
import { buildHarnessRequest } from "./build-harness-request.js";
import type { HarnessResponse, ThreadContextKind } from "./contracts.js";

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

  constructor(
    private readonly store: SqliteStore,
    private readonly codexClient: CodexAppServerClient,
    private readonly sessionPolicyResolver: SessionPolicyResolver,
    private readonly sessionManager: SessionManager,
    private readonly logger: Logger
  ) {
    this.knowledgePersistence = new KnowledgePersistenceService(store, logger);
  }

  async routeMessage(input: HarnessMessageContext): Promise<{
    response: HarnessResponse;
    session: HarnessResolvedSession;
    knowledgePersistenceScope: Scope | null;
  }> {
    const threadContext = this.buildThreadContext(input.envelope, input.watchLocation);
    const overrideContext = this.buildOverrideContext(input);
    const workspaceWriteActive = canUseWorkspaceWrite(input, overrideContext);
    const normalizedEnvelope = normalizeEnvelope(input.envelope);
    const fetchablePublicUrlCount = normalizedEnvelope.urls.filter((url) =>
      isAllowedPublicHttpUrl(url)
    ).length;
    const sessionIdentity = this.sessionPolicyResolver.resolveForMessage({
      envelope: normalizedEnvelope,
      watchLocation: input.watchLocation,
      actorRole: input.actorRole,
      scope: input.scope,
      workspaceWriteActive
    });
    const session = await this.sessionManager.getOrStartSession(sessionIdentity);
    const resolvedSession: HarnessResolvedSession = {
      identity: sessionIdentity,
      threadId: session.threadId,
      startedFresh: session.startedFresh
    };
    const request = buildHarnessRequest({
      actorRole: input.actorRole,
      scope: input.scope,
      watchLocation: input.watchLocation,
      envelope: normalizedEnvelope,
      taskKind: "route_message",
      overrideContext,
      threadContext,
      allowExternalFetch: true,
      allowKnowledgeWrite: true,
      allowModeration: workspaceWriteActive || input.actorRole !== "user",
      discordRuntimeFactsPath: input.discordRuntimeFactsPath ?? null
    });

    this.logger.debug(
      {
        messageId: input.envelope.messageId,
        placeMode: input.watchLocation.mode,
        threadKind: threadContext.kind,
        workspaceWriteActive,
        sessionIdentity: sessionIdentity.sessionIdentity,
        workloadKind: sessionIdentity.workloadKind,
        sandboxMode: sessionIdentity.sandboxMode,
        runtimeContractVersion: sessionIdentity.runtimeContractVersion,
        allowExternalFetch: request.capabilities.allow_external_fetch,
        allowKnowledgeWrite: request.capabilities.allow_knowledge_write
      },
      "routing discord message through harness"
    );

    const rawResponse = await this.codexClient.runHarnessRequest(
      resolvedSession.threadId,
      request,
      {
        sessionIdentity: sessionIdentity.sessionIdentity,
        workloadKind: sessionIdentity.workloadKind,
        modelProfile: sessionIdentity.modelProfile,
        runtimeContractVersion: sessionIdentity.runtimeContractVersion
      }
    );
    const normalizedResponse = normalizeProductResponse(
      input,
      threadContext,
      rawResponse,
      {
        fetchablePublicUrlCount
      }
    );

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

    if (normalizedResponse.repo_write_intent && !workspaceWriteActive) {
      return {
        response: buildOverrideRequiredResponse(input),
        session: resolvedSession,
        knowledgePersistenceScope: null
      };
    }

    return {
      response: normalizedResponse,
      session: resolvedSession,
      knowledgePersistenceScope: resolveKnowledgePersistenceScope(
        input.scope,
        input.watchLocation,
        threadContext,
        normalizedResponse,
        fetchablePublicUrlCount
      )
    };
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
    persist_items: [],
    diagnostics: {
      notes: "repo write intent denied without active override"
    },
    sensitivity_raise: "none"
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
    knowledge_writes: dedupeKnowledgeWrites(baseResponse.knowledge_writes),
    persist_items: []
  };

  if (
    shouldRescueKnowledgeThreadFollowUp(input, threadContext, dedupedResponse)
  ) {
    return {
      outcome: "chat_reply",
      repo_write_intent: false,
      public_text: buildKnowledgeThreadFallbackReply(input, threadContext),
      reply_mode: "same_place",
      target_thread_id: null,
      selected_source_ids: [],
      sources_used: [],
      knowledge_writes: [],
      persist_items: [],
      diagnostics: {
        notes: "rescued silent knowledge-thread follow-up with same-thread reply"
      },
      sensitivity_raise: dedupedResponse.sensitivity_raise
    };
  }

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
  const knowledgeWrites = response.knowledge_writes.length > 0
    ? response.knowledge_writes
    : response.persist_items;
  const normalizedResponse = {
    ...response,
    knowledge_writes: knowledgeWrites,
    persist_items: []
  };

  if (normalizedResponse.outcome !== "knowledge_ingest") {
    return normalizedResponse;
  }

  const shouldCreatePublicThread =
    input.watchLocation.mode === "url_watch" &&
    threadContext.kind === "root_channel" &&
    policy.fetchablePublicUrlCount > 0;

  return {
    ...normalizedResponse,
    public_text:
      normalizedResponse.public_text?.trim() || buildKnowledgeReplyText(normalizedResponse),
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

function shouldRescueKnowledgeThreadFollowUp(
  input: HarnessMessageContext,
  threadContext: ResolvedThreadContext,
  response: HarnessResponse
): boolean {
  if (
    threadContext.kind !== "knowledge_thread" ||
    input.envelope.content.trim().length === 0
  ) {
    return false;
  }

  return !wouldProduceVisibleReply(response);
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

function buildKnowledgeThreadFallbackReply(
  input: HarnessMessageContext,
  threadContext: ResolvedThreadContext
): string {
  const requestText = input.envelope.content.trim();
  const sourceTitle = threadContext.knowledgeEntries[0]?.title?.trim();

  if (requestText.includes("日本語")) {
    return sourceTitle
      ? `このスレッドは「${sourceTitle}」の follow-up 会話として続けられます。日本語での言い換え依頼として扱うべき場面でしたが、無言で落ちないように system 側で保護しました。必要なら同じ依頼をもう一度送ってください。`
      : "このスレッドの follow-up は same thread の会話として扱います。日本語での言い換え依頼として扱うべき場面でしたが、無言で落ちないように system 側で保護しました。必要なら同じ依頼をもう一度送ってください。";
  }

  return sourceTitle
    ? `このスレッドは「${sourceTitle}」の follow-up 会話として same thread に返答します。無言で落ちないように system 側で保護しました。必要なら同じ依頼をもう一度送ってください。`
    : "このスレッドの follow-up は same thread の会話として扱います。無言で落ちないように system 側で保護しました。必要なら同じ依頼をもう一度送ってください。";
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
