import type { Logger } from "pino";

import type { CodexAppServerClient } from "../codex/app-server-client.js";
import type {
  ActorRole,
  MessageEnvelope,
  Scope,
  WatchLocationConfig
} from "../domain/types.js";
import { KnowledgePersistenceService } from "../knowledge/knowledge-persistence-service.js";
import type { SqliteStore } from "../storage/database.js";
import { buildHarnessRequest } from "./build-harness-request.js";
import type { HarnessResponse, ThreadContextKind } from "./contracts.js";

type HarnessMessageContext = {
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
  actorRole: ActorRole;
  scope: Scope;
};

export class HarnessRunner {
  private readonly knowledgePersistence: KnowledgePersistenceService;

  constructor(
    private readonly store: SqliteStore,
    private readonly codexClient: CodexAppServerClient,
    private readonly logger: Logger
  ) {
    this.knowledgePersistence = new KnowledgePersistenceService(store, logger);
  }

  async routeMessage(input: HarnessMessageContext): Promise<{
    response: HarnessResponse;
    codexThreadId: string;
  }> {
    const threadContext = this.buildThreadContext(input.envelope, input.watchLocation);
    const canFetchKnownSources =
      threadContext.kind === "knowledge_thread" &&
      threadContext.knownSourceUrls.length > 0;
    const threadId = await this.getOrStartThread(resolveHarnessPlaceId(input));
    const request = buildHarnessRequest({
      actorRole: input.actorRole,
      scope: input.scope,
      watchLocation: input.watchLocation,
      envelope: normalizeEnvelope(input.envelope),
      taskKind: "route_message",
      threadContext,
      allowThreadCreate:
        input.envelope.urls.length > 0 &&
        !input.envelope.placeType.endsWith("thread") &&
        input.watchLocation.mode !== "admin_control",
      allowExternalFetch: input.envelope.urls.length > 0 || canFetchKnownSources,
      allowKnowledgeWrite:
        input.envelope.urls.length > 0 &&
        input.watchLocation.mode !== "admin_control",
      allowModeration: input.actorRole !== "user"
    });

    return {
      response: await this.codexClient.runHarnessRequest(threadId, request),
      codexThreadId: threadId
    };
  }

  persistKnowledgeResult(input: HarnessMessageContext & {
    response: HarnessResponse;
    replyThreadId: string;
  }): void {
    this.knowledgePersistence.persist({
      response: input.response,
      sourceUrls: input.envelope.urls,
      scope: input.scope,
      sourceMessageId: input.envelope.messageId,
      replyThreadId: input.replyThreadId
    });
  }

  private async getOrStartThread(placeId: string): Promise<string> {
    const existing = this.store.codexSessions.get(placeId);
    if (existing) {
      try {
        await this.codexClient.resumeThread(existing.codex_thread_id);
        return existing.codex_thread_id;
      } catch (error) {
        this.logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            placeId,
            codexThreadId: existing.codex_thread_id
          },
          "failed to resume harness codex thread; starting a new thread"
        );
      }
    }

    const threadId = await this.codexClient.startThread();
    this.store.codexSessions.upsert(placeId, threadId);
    return threadId;
  }

  private buildThreadContext(
    envelope: MessageEnvelope,
    watchLocation: WatchLocationConfig
  ): {
    kind: ThreadContextKind;
    sourceMessageId: string | null;
    knownSourceUrls: string[];
    replyThreadId: string | null;
    rootChannelId: string;
  } {
    if (!envelope.placeType.endsWith("thread")) {
      return {
        kind: "root_channel",
        sourceMessageId: null,
        knownSourceUrls: [],
        replyThreadId: null,
        rootChannelId: watchLocation.channelId
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
        rootChannelId: watchLocation.channelId
      };
    }

    return {
      kind: "knowledge_thread",
      sourceMessageId: threadKnowledge[0]?.sourceMessageId ?? null,
      knownSourceUrls: threadKnowledge.map((candidate) => candidate.canonicalUrl),
      replyThreadId: envelope.channelId,
      rootChannelId: watchLocation.channelId
    };
  }
}

export function resolveHarnessPlaceId(input: HarnessMessageContext): string {
  if (input.envelope.placeType.endsWith("thread")) {
    return input.envelope.channelId;
  }

  if (input.envelope.urls.length > 0 && input.watchLocation.mode !== "admin_control") {
    return `${input.envelope.channelId}:message:${input.envelope.messageId}`;
  }

  return `${input.envelope.channelId}:${input.watchLocation.mode}`;
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

export function buildKnowledgeReplyText(response: HarnessResponse): string {
  const direct = response.public_text?.trim();
  if (direct) {
    return direct;
  }

  const summaries = response.persist_items
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
