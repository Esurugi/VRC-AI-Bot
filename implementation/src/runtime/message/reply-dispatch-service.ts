import {
  ChannelType,
  ThreadAutoArchiveDuration,
  type AnyThreadChannel,
  type Channel,
  type NewsChannel,
  type TextChannel
} from "discord.js";
import type { Logger } from "pino";

import {
  buildAdminDiagnosticsReply,
  buildPermanentFailureReply,
  buildPlainTextReply,
  buildSanctionStateChangeReply,
  splitPlainTextReplies
} from "../../app/replies.js";
import { SessionManager } from "../../codex/session-manager.js";
import { SessionPolicyResolver } from "../../codex/session-policy.js";
import type { MessageEnvelope, Scope, WatchLocationConfig } from "../../domain/types.js";
import {
  buildKnowledgeReplyText,
  type HarnessResolvedSession,
  type HarnessRunner
} from "../../harness/harness-runner.js";
import type { HarnessResponse } from "../../harness/contracts.js";
import {
  canonicalizeUrl,
  isAllowedPublicHttpUrl
} from "../../playwright/url-policy.js";
import type { SqliteStore, RetryJobRow } from "../../storage/database.js";
import type { FailurePublicCategory, FailureStage } from "../../app/failure-classifier.js";
import type { SanctionNotificationPayload } from "../../app/moderation-integration.js";
import { appendRuntimeTrace } from "../../observability/runtime-trace.js";
import type {
  FailureReplyTarget,
  QueuedMessage,
  RoutedHarnessMessage,
  StageFailureInput
} from "../types.js";

type RoutedMessageContext = {
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
  actorRole: QueuedMessage["actorRole"];
  scope: Scope;
};

type ReplyDispatchDependencies = {
  store: SqliteStore;
  harnessRunner: HarnessRunner;
  sessionManager: SessionManager;
  sessionPolicyResolver: SessionPolicyResolver;
  watchLocations: WatchLocationConfig[];
  logger: Pick<Logger, "debug" | "warn">;
  fetchChannel: (channelId: string) => Promise<Channel | null>;
};

export class ReplyDispatchService {
  constructor(private readonly dependencies: ReplyDispatchDependencies) {}

  async dispatchResolvedMessage(
    item: QueuedMessage,
    routed: RoutedHarnessMessage | null
  ): Promise<FailureReplyTarget> {
    if (!routed) {
      return buildSamePlaceReplyTarget(item);
    }

    if (
      routed.primaryReplyAlreadySent &&
      routed.response.outcome === "chat_reply" &&
      routed.response.public_text?.trim()
    ) {
      await this.sendReferenceAppendixIfNeeded(
        {
          sendFollowupInSamePlace: async (content) =>
            this.sendFollowupInSamePlace(item, content)
        },
        {
          envelope: item.envelope,
          watchLocation: item.watchLocation,
          actorRole: item.actorRole,
          scope: item.scope
        },
        routed.response
      );
      return buildSamePlaceReplyTarget(item);
    }

    return this.dispatchHarnessResponse(
      item,
      routed.response,
      routed.session,
      routed.knowledgePersistenceScope
    );
  }

  async dispatchHarnessResponse(
    item: QueuedMessage,
    response: HarnessResponse,
    session: HarnessResolvedSession,
    knowledgePersistenceScope: Scope | null
  ): Promise<FailureReplyTarget> {
    return this.dispatchHarnessResponseWithContext(
      {
        envelope: item.envelope,
        watchLocation: item.watchLocation,
        actorRole: item.actorRole,
        scope: item.scope
      },
      {
        replyInSamePlace: async (content) => this.replyInSamePlace(item, content),
        sendFollowupInSamePlace: async (content) =>
          this.sendFollowupInSamePlace(item, content),
        resolveSamePlaceReplyTarget: () => buildSamePlaceReplyTarget(item),
        sendToExistingThread: async (content, threadId) => {
          const channel = await this.fetchReplyChannel(threadId);
          if (!channel || !channel.isThread()) {
            throw new Error("thread no longer available");
          }
          await this.sendChunksToChannel(channel, content);
        },
        resolveKnowledgeThread: async () => this.resolveKnowledgeThread(item)
      },
      response,
      session,
      knowledgePersistenceScope
    );
  }

  async dispatchHarnessResponseToChannel(input: {
    channel: AnyThreadChannel;
    messageContext: RoutedMessageContext;
    response: HarnessResponse;
    session: HarnessResolvedSession;
    knowledgePersistenceScope: Scope | null;
  }): Promise<FailureReplyTarget> {
    return this.dispatchHarnessResponseWithContext(
      input.messageContext,
      {
        replyInSamePlace: async (content) => this.sendChunksToChannel(input.channel, content),
        sendFollowupInSamePlace: async (content) =>
          this.sendChunksToChannel(input.channel, content),
        resolveSamePlaceReplyTarget: () => ({
          channelId: input.channel.id,
          threadId: input.channel.id
        }),
        sendToExistingThread: async (content, threadId) => {
          if (threadId !== input.channel.id) {
            throw new Error("thread no longer available");
          }
          await this.sendChunksToChannel(input.channel, content);
        },
        resolveKnowledgeThread: async () => input.channel
      },
      input.response,
      input.session,
      input.knowledgePersistenceScope
    );
  }

  private async dispatchHarnessResponseWithContext(
    messageContext: RoutedMessageContext,
    dispatchTarget: {
      replyInSamePlace: (content: string) => Promise<void>;
      sendFollowupInSamePlace: (content: string) => Promise<void>;
      resolveSamePlaceReplyTarget: () => FailureReplyTarget;
      sendToExistingThread: (content: string, threadId: string) => Promise<void>;
      resolveKnowledgeThread: () => Promise<AnyThreadChannel>;
    },
    response: HarnessResponse,
    session: HarnessResolvedSession,
    knowledgePersistenceScope: Scope | null
  ): Promise<FailureReplyTarget> {
    this.dependencies.logger.debug(
      {
        messageId: messageContext.envelope.messageId,
        channelId: messageContext.envelope.channelId,
        outcome: response.outcome,
        replyMode: response.reply_mode,
        codexThreadId: session.threadId,
        sessionIdentity: session.identity.sessionIdentity,
        workloadKind: session.identity.workloadKind,
        modelProfile: session.identity.modelProfile,
        runtimeContractVersion: session.identity.runtimeContractVersion,
        hasPublicText: Boolean(response.public_text?.trim())
      },
      "dispatching harness response to discord"
    );

    switch (response.outcome) {
      case "ignore":
        return dispatchTarget.resolveSamePlaceReplyTarget();
      case "admin_diagnostics":
        await dispatchTarget.replyInSamePlace(
          buildAdminDiagnosticsReply({
            messageId: messageContext.envelope.messageId,
            placeMode: messageContext.watchLocation.mode,
            actorRole: messageContext.actorRole,
            resolvedScope: messageContext.scope,
            codexThreadId: session.threadId,
            sessionIdentity: session.identity.sessionIdentity,
            workloadKind: session.identity.workloadKind,
            modelProfile: session.identity.modelProfile,
            runtimeContractVersion: session.identity.runtimeContractVersion,
            notes: response.diagnostics.notes
          })
        );
        return dispatchTarget.resolveSamePlaceReplyTarget();
      case "knowledge_ingest":
        return this.processKnowledgeIngest(
          messageContext,
          dispatchTarget,
          response,
          session,
          knowledgePersistenceScope
        );
      case "chat_reply":
        if (response.reply_mode === "no_reply") {
          return dispatchTarget.resolveSamePlaceReplyTarget();
        }
        if (response.public_text?.trim()) {
          await dispatchTarget.replyInSamePlace(response.public_text);
          await this.sendReferenceAppendixIfNeeded(
            dispatchTarget,
            messageContext,
            response
          );
        }
        return dispatchTarget.resolveSamePlaceReplyTarget();
      case "failure":
        await dispatchTarget.replyInSamePlace(
          response.public_text?.trim() ? response.public_text : "AI処理に失敗しました。"
        );
        return dispatchTarget.resolveSamePlaceReplyTarget();
    }
  }

  async notifyFailureInTarget(
    item: QueuedMessage,
    target: FailureReplyTarget,
    content: string
  ): Promise<void> {
    if (!target.threadId) {
      await this.replyInSamePlace(item, content);
      return;
    }

    const channel = await this.fetchReplyChannel(target.threadId);
    if (!channel || !channel.isThread()) {
      throw new Error("thread no longer available");
    }
    await this.sendChunksToChannel(channel, content);
  }

  async notifyFailureForRetryJob(
    job: RetryJobRow,
    content: string
  ): Promise<void> {
    const targetChannelId = job.reply_thread_id ?? job.reply_channel_id;
    const channel = await this.fetchReplyChannel(targetChannelId);
    if (!channel) {
      throw new Error("channel no longer available");
    }

    if (channel.isThread()) {
      await this.sendChunksToChannel(channel, content);
      return;
    }

    for (const chunk of splitPlainTextReplies(content)) {
      await channel.send({
        content: chunk,
        allowedMentions: {
          parse: []
        }
      });
    }
  }

  async notifyPermanentFailure(input: {
    guildId: string;
    messageId: string;
    placeMode: WatchLocationConfig["mode"];
    channelId: string;
    error: unknown;
    stage: FailureStage;
    category: FailurePublicCategory;
  }): Promise<void> {
    const failureTarget = findAdminControlWatchLocation(
      this.dependencies.watchLocations,
      input.guildId
    );

    if (!failureTarget) {
      return;
    }

    const channel = await this.fetchWatchBaseChannel(failureTarget.channelId);
    if (!channel) {
      return;
    }

    await channel.send({
      content: buildPermanentFailureReply({
        messageId: input.messageId,
        placeMode: input.placeMode,
        channelId: input.channelId,
        stage: input.stage,
        category: input.category,
        error:
          input.error instanceof Error ? input.error.message : String(input.error)
      }),
      allowedMentions: {
        parse: []
      }
    });
  }

  async notifySanctionStateChange(
    guildId: string,
    payload: SanctionNotificationPayload
  ): Promise<void> {
    const failureTarget = findAdminControlWatchLocation(
      this.dependencies.watchLocations,
      guildId
    );
    if (!failureTarget) {
      return;
    }

    const channel = await this.fetchWatchBaseChannel(failureTarget.channelId);
    if (!channel) {
      return;
    }

    await channel.send({
      content: buildSanctionStateChangeReply(payload),
      allowedMentions: {
        parse: []
      }
    });
  }

  async fetchReplyChannel(
    channelId: string
  ): Promise<TextChannel | NewsChannel | AnyThreadChannel | null> {
    const channel = await this.dependencies.fetchChannel(channelId);
    if (!channel) {
      return null;
    }

    if (isBaseWatchChannel(channel)) {
      return channel;
    }

    if (channel.isThread()) {
      return channel;
    }

    return null;
  }

  async fetchWatchBaseChannel(
    channelId: string
  ): Promise<TextChannel | NewsChannel | null> {
    const channel = await this.dependencies.fetchChannel(channelId);
    if (!channel || !isBaseWatchChannel(channel)) {
      return null;
    }
    return channel;
  }

  async sendChunksToChannel(
    channel: AnyThreadChannel,
    content: string
  ): Promise<void> {
    for (const chunk of splitPlainTextReplies(content)) {
      await channel.send({
        content: chunk,
        allowedMentions: {
          parse: []
        }
      });
    }
  }

  async replyInSamePlace(item: QueuedMessage, content: string): Promise<void> {
    const chunks = splitPlainTextReplies(content);
    const [firstChunk, ...restChunks] = chunks;
    await item.message.reply({
      content: firstChunk ?? buildPlainTextReply(content),
      allowedMentions: {
        repliedUser: false
      }
    });
    for (const chunk of restChunks) {
      await item.message.channel.send({
        content: chunk,
        allowedMentions: {
          parse: []
        }
      });
    }
    appendRuntimeTrace("codex-app-server", "discord_reply_sent", {
      messageId: item.envelope.messageId,
      channelId: item.envelope.channelId,
      watchMode: item.watchLocation.mode,
      chunkCount: chunks.length,
      firstChunkLength: (firstChunk ?? "").length
    });
  }

  async sendFollowupInSamePlace(item: QueuedMessage, content: string): Promise<void> {
    const chunks = splitPlainTextReplies(content);
    for (const chunk of chunks) {
      await item.message.channel.send({
        content: chunk,
        allowedMentions: {
          parse: []
        }
      });
    }
    appendRuntimeTrace("codex-app-server", "discord_followup_sent", {
      messageId: item.envelope.messageId,
      channelId: item.envelope.channelId,
      watchMode: item.watchLocation.mode,
      chunkCount: chunks.length
    });
  }

  async createStreamingReplyInSamePlace(item: QueuedMessage): Promise<{
    append: (delta: string) => Promise<void>;
    complete: () => Promise<void>;
  }> {
    const sentMessages: Array<{
      edit: (input: { content: string; allowedMentions: { parse: [] } }) => Promise<unknown>;
    }> = [];
    const sentContents: string[] = [];
    let accumulated = "";
    let flushPromise = Promise.resolve();
    let flushTimer: NodeJS.Timeout | null = null;

    const flushNow = async (): Promise<void> => {
      const chunks = splitPlainTextReplies(accumulated || " ");
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index] ?? "";
        if (sentMessages[index]) {
          if (sentContents[index] === chunk) {
            continue;
          }
          await sentMessages[index]?.edit({
            content: chunk,
            allowedMentions: { parse: [] }
          });
          sentContents[index] = chunk;
          continue;
        }

        const message = await item.message.channel.send({
          content: chunk,
          allowedMentions: {
            parse: []
          }
        });
        sentMessages.push(message);
        sentContents.push(chunk);
      }
    };

    const scheduleFlush = (): void => {
      if (flushTimer) {
        return;
      }

      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushPromise = flushPromise.then(() => flushNow());
      }, 300);
    };

    return {
      append: async (delta: string) => {
        accumulated += delta;
        scheduleFlush();
      },
      complete: async () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flushPromise = flushPromise.then(() => flushNow());
        await flushPromise;
      }
    };
  }

  private async sendReferenceAppendixIfNeeded(
    dispatchTarget: {
      sendFollowupInSamePlace: (content: string) => Promise<void>;
    },
    messageContext: RoutedMessageContext,
    response: HarnessResponse
  ): Promise<void> {
    if (messageContext.watchLocation.mode !== "forum_longform") {
      return;
    }

    const referenceReply = buildReferenceReply(response.sources_used);
    if (!referenceReply) {
      return;
    }

    await dispatchTarget.sendFollowupInSamePlace(referenceReply);
    appendRuntimeTrace("codex-app-server", "discord_reference_appendix_sent", {
      messageId: messageContext.envelope.messageId,
      channelId: messageContext.envelope.channelId,
      watchMode: messageContext.watchLocation.mode,
      sourceCount: extractReferenceUrls(response.sources_used).length,
      chunkCount: splitPlainTextReplies(referenceReply).length
    });
  }

  private async processKnowledgeIngest(
    item: RoutedMessageContext,
    dispatchTarget: {
      replyInSamePlace: (content: string) => Promise<void>;
      sendFollowupInSamePlace: (content: string) => Promise<void>;
      resolveSamePlaceReplyTarget: () => FailureReplyTarget;
      sendToExistingThread: (content: string, threadId: string) => Promise<void>;
      resolveKnowledgeThread: () => Promise<AnyThreadChannel>;
    },
    response: HarnessResponse,
    session: HarnessResolvedSession,
    persistenceScope: Scope | null
  ): Promise<FailureReplyTarget> {
    const routing = resolveKnowledgeIngestRouting({
      isThreadMessage: item.envelope.placeType.endsWith("thread"),
      watchMode: item.watchLocation.mode,
      replyMode: response.reply_mode,
      hasMessageUrls: item.envelope.urls.length > 0
    });

    if (routing.kind === "same_place") {
      if (persistenceScope) {
        this.dependencies.harnessRunner.persistKnowledgeResult({
          envelope: item.envelope,
          watchLocation: item.watchLocation,
          actorRole: item.actorRole,
          scope: item.scope,
          persistenceScope,
          replyThreadId: item.envelope.placeType.endsWith("thread") ? item.envelope.channelId : null,
          response
        });
      }
      await dispatchTarget.replyInSamePlace(buildKnowledgeReplyText(response));
      await this.sendReferenceAppendixIfNeeded(dispatchTarget, item, response);
      return dispatchTarget.resolveSamePlaceReplyTarget();
    }

    const targetThread = await dispatchTarget.resolveKnowledgeThread();
    const replyTarget = {
      channelId: targetThread.id,
      threadId: targetThread.id
    } satisfies FailureReplyTarget;
    try {
      this.dependencies.sessionManager.bindSession(
        this.dependencies.sessionPolicyResolver.resolveKnowledgeThreadConversation({
          threadId: targetThread.id
        }),
        session.threadId
      );
      if (persistenceScope) {
        this.dependencies.harnessRunner.persistKnowledgeResult({
          envelope: item.envelope,
          watchLocation: item.watchLocation,
          actorRole: item.actorRole,
          scope: item.scope,
          persistenceScope,
          replyThreadId: targetThread.id,
          response
        });
      }

      await dispatchTarget.sendToExistingThread(
        buildKnowledgeReplyText(response),
        targetThread.id
      );
      await this.sendReferenceAppendixIfNeeded(dispatchTarget, item, response);
      return replyTarget;
    } catch (error) {
      throw attachReplyTarget(error, replyTarget);
    }
  }

  private async resolveKnowledgeThread(
    item: QueuedMessage
  ): Promise<AnyThreadChannel> {
    if (item.message.channel.isThread()) {
      return item.message.channel;
    }

    return item.message.startThread({
      name: buildKnowledgeThreadName(item.envelope),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: "Create public knowledge thread for URL ingest"
    });
  }
}

export function resolveKnowledgeIngestRouting(input: {
  isThreadMessage: boolean;
  watchMode: WatchLocationConfig["mode"];
  replyMode: HarnessResponse["reply_mode"];
  hasMessageUrls: boolean;
}): {
  kind: "same_place" | "create_public_thread";
} {
  if (input.isThreadMessage) {
    return {
      kind: "same_place"
    };
  }

  if (
    input.replyMode === "same_place" ||
    input.watchMode !== "url_watch" ||
    !input.hasMessageUrls
  ) {
    return {
      kind: "same_place"
    };
  }

  return {
    kind: "create_public_thread"
  };
}

export function buildSamePlaceReplyTarget(item: QueuedMessage): FailureReplyTarget {
  return {
    channelId: item.message.channelId,
    threadId: item.message.channel.isThread() ? item.message.channel.id : null
  };
}

export function buildReferenceReply(sourcesUsed: string[]): string | null {
  const referenceUrls = extractReferenceUrls(sourcesUsed);
  if (referenceUrls.length === 0) {
    return null;
  }

  return referenceUrls.map((url, index) => `[${index + 1}]: ${url}`).join("\n");
}

export function extractReferenceUrls(sourcesUsed: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const source of sourcesUsed) {
    if (!isAllowedPublicHttpUrl(source)) {
      continue;
    }

    const canonicalUrl = safeCanonicalizeUrl(source);
    if (seen.has(canonicalUrl)) {
      continue;
    }

    seen.add(canonicalUrl);
    deduped.push(canonicalUrl);
  }

  return deduped;
}

export function extractStageFailure(
  error: unknown,
  item: QueuedMessage,
  stage: FailureStage
): StageFailureInput {
  return {
    stage,
    error,
    replyTarget: readReplyTarget(error) ?? buildSamePlaceReplyTarget(item)
  };
}

export function attachReplyTarget(
  error: unknown,
  replyTarget: FailureReplyTarget
): Error & { replyTarget: FailureReplyTarget } {
  const normalized =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : String(error));
  return Object.assign(normalized, { replyTarget });
}

export function buildSchedulerEnvelope(job: RetryJobRow): MessageEnvelope {
  return {
    guildId: job.guild_id,
    channelId: job.message_channel_id,
    messageId: job.message_id,
    authorId: "retry-scheduler",
    placeType: job.reply_thread_id ? "public_thread" : "chat_channel",
    rawPlaceType: job.reply_thread_id ? "public_thread" : "chat_channel",
    content: "",
    urls: [],
    receivedAt: new Date().toISOString()
  };
}

export function findAdminControlWatchLocation(
  watchLocations: WatchLocationConfig[],
  guildId: string
): WatchLocationConfig | null {
  return (
    watchLocations.find(
      (location) => location.guildId === guildId && location.mode === "admin_control"
    ) ?? null
  );
}

function readReplyTarget(error: unknown): FailureReplyTarget | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as { replyTarget?: FailureReplyTarget };
  if (!candidate.replyTarget) {
    return null;
  }

  return candidate.replyTarget;
}

function buildKnowledgeThreadName(envelope: MessageEnvelope): string {
  const firstUrl = envelope.urls[0];
  if (!firstUrl) {
    return `shared-link-${envelope.messageId.slice(-6)}`;
  }

  try {
    const hostname = new URL(firstUrl).hostname.replace(/\./g, "-");
    return `${hostname}-${envelope.messageId.slice(-6)}`.slice(0, 100);
  } catch {
    return `shared-link-${envelope.messageId.slice(-6)}`;
  }
}

function safeCanonicalizeUrl(url: string): string {
  try {
    return canonicalizeUrl(url);
  } catch {
    return url;
  }
}

function isBaseWatchChannel(
  channel: Channel | null
): channel is TextChannel | NewsChannel {
  if (!channel) {
    return false;
  }

  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  );
}
