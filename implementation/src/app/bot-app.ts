import { randomUUID } from "node:crypto";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  ThreadAutoArchiveDuration,
  type AnyThreadChannel,
  type Channel,
  type GuildTextBasedChannel,
  type Message,
  type NewsChannel,
  type TextChannel
} from "discord.js";
import pino, { type Logger } from "pino";

import {
  buildAdminDiagnosticsReply,
  buildPlainTextReply
} from "./replies.js";
import { CodexAppServerClient } from "../codex/app-server-client.js";
import { loadConfig } from "../config/load-config.js";
import {
  buildMessageEnvelope,
  isEligibleMessage,
  resolveWatchLocation,
  shouldProcessMessage
} from "../discord/message-utils.js";
import { resolveActorRole, resolveScope } from "../discord/facts.js";
import type { AppConfig, MessageEnvelope, Scope, WatchLocationConfig } from "../domain/types.js";
import { buildKnowledgeReplyText, HarnessRunner } from "../harness/harness-runner.js";
import type { HarnessResponse } from "../harness/contracts.js";
import { OrderedMessageQueue } from "../queue/ordered-message-queue.js";
import { SqliteStore } from "../storage/database.js";

type QueuedMessage = {
  messageId: string;
  orderingKey: string;
  message: Message<true>;
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
  actorRole: ReturnType<typeof resolveActorRole>;
  scope: Scope;
};

export class BotApplication {
  private readonly logger: Logger;
  private readonly store: SqliteStore;
  private readonly codexClient: CodexAppServerClient;
  private readonly harnessRunner: HarnessRunner;
  private readonly queue: OrderedMessageQueue<QueuedMessage>;
  private readonly client: Client;
  private readonly runtimeInstanceId = randomUUID();
  private runtimeLeaseTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: AppConfig) {
    this.logger = pino({
      level: config.botLogLevel
    });
    this.store = new SqliteStore(config.botDbPath);
    this.codexClient = new CodexAppServerClient(
      config.codexAppServerCommand,
      process.cwd(),
      config.codexHomePath,
      this.logger
    );
    this.harnessRunner = new HarnessRunner(
      this.store,
      this.codexClient,
      this.logger
    );
    this.queue = new OrderedMessageQueue(async (item) => this.processQueueItem(item));
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
  }

  async start(): Promise<void> {
    this.store.migrate();
    const lockAcquired = this.store.runtimeLock.tryAcquire(
      this.runtimeInstanceId,
      process.pid
    );
    if (!lockAcquired) {
      throw new Error("another vrc-ai-bot instance is already active");
    }

    this.store.watchLocations.sync(this.config.watchLocations);
    this.logger.info(
      {
        watchLocationCount: this.config.watchLocations.length,
        botDbPath: this.config.botDbPath
      },
      "starting discord bot application"
    );
    await this.codexClient.start();
    this.bindEvents();
    await this.client.login(this.config.discordBotToken);
    await onceReady(this.client);
    this.startRuntimeLeaseHeartbeat();
    await this.seedInitialCursors();
    await this.catchUpPendingMessages();
  }

  async stop(): Promise<void> {
    if (this.runtimeLeaseTimer) {
      clearInterval(this.runtimeLeaseTimer);
      this.runtimeLeaseTimer = null;
    }
    this.store.runtimeLock.release(this.runtimeInstanceId);
    await this.codexClient.close();
    this.client.destroy();
    this.store.close();
  }

  private bindEvents(): void {
    this.client.on(Events.ClientReady, () => {
      this.logger.info("discord client ready");
    });

    this.client.on(Events.MessageCreate, async (message) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        this.logger.error({ error }, "failed to handle incoming message");
      }
    });
  }

  private async seedInitialCursors(): Promise<void> {
    for (const watchLocation of this.config.watchLocations) {
      const channel = await this.fetchWatchBaseChannel(watchLocation.channelId);
      if (!channel) {
        this.logger.warn({ channelId: watchLocation.channelId }, "watch location channel not found");
        continue;
      }

      await this.seedCursorIfMissing(channel);
      for (const thread of await this.fetchActiveThreads(channel)) {
        await this.seedCursorIfMissing(thread);
      }
    }
  }

  private async catchUpPendingMessages(): Promise<void> {
    for (const watchLocation of this.config.watchLocations) {
      const baseChannel = await this.fetchWatchBaseChannel(watchLocation.channelId);
      if (!baseChannel) {
        continue;
      }

      const places = [baseChannel, ...(await this.fetchActiveThreads(baseChannel))];
      for (const place of places) {
        await this.catchUpChannel(place);
      }
    }
  }

  private async catchUpChannel(channel: TextChannel | NewsChannel | AnyThreadChannel): Promise<void> {
    const cursor = this.store.channelCursors.get(channel.id);
    let beforeDone = false;
    let lastSeenId: string | undefined;

    while (!beforeDone) {
      const batch = await channel.messages.fetch({
        limit: 100,
        ...(lastSeenId ? { before: lastSeenId } : {})
      });
      if (batch.size === 0) {
        return;
      }

      const ordered = [...batch.values()].sort((left, right) =>
        BigInt(left.id) < BigInt(right.id) ? -1 : 1
      );
      const pending = cursor
        ? ordered.filter((message) => BigInt(message.id) > BigInt(cursor.last_processed_message_id))
        : ordered;

      for (const message of pending) {
        await this.handleMessage(message);
      }

      if (cursor && ordered.some((message) => message.id === cursor.last_processed_message_id)) {
        beforeDone = true;
      }

      if (batch.size < 100) {
        beforeDone = true;
      }
      lastSeenId = ordered[0]?.id;
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.inGuild()) {
      return;
    }

    const watchLocation = resolveWatchLocation(message, this.config.watchLocations);
    if (!watchLocation) {
      return;
    }

    if (!isEligibleMessage(message)) {
      return;
    }

    const typedMessage = message as Message<true>;
    const envelope = buildMessageEnvelope(typedMessage, watchLocation);
    const actorRole = resolveActorRole(typedMessage, this.config.discordOwnerUserIds);
    const scope = resolveScope(typedMessage, watchLocation);

    const enqueued = this.queue.enqueue({
      messageId: typedMessage.id,
      orderingKey: typedMessage.channelId,
      message: typedMessage,
      envelope,
      watchLocation,
      actorRole,
      scope
    });

    if (enqueued) {
      await this.tryAddProcessingReaction(typedMessage);
    }
  }

  private async processQueueItem(item: QueuedMessage): Promise<void> {
    const acquired = this.store.messageProcessing.tryAcquire(
      item.envelope.messageId,
      item.envelope.channelId
    );
    if (!acquired) {
      this.logger.info(
        { messageId: item.envelope.messageId, channelId: item.envelope.channelId },
        "skipping duplicate message processing"
      );
      this.store.channelCursors.upsert(item.envelope.channelId, item.envelope.messageId);
      return;
    }

    const stopTyping = this.startTypingIndicator(item.message.channel);
    try {
      await this.handleResolvedMessage(item);
      this.store.channelCursors.upsert(item.envelope.channelId, item.envelope.messageId);
      this.store.messageProcessing.markCompleted(item.envelope.messageId);
    } catch (error) {
      this.logger.error({ error, messageId: item.envelope.messageId }, "queue item failed");
      await this.notifyPermanentFailure(item, error);
      this.store.channelCursors.upsert(item.envelope.channelId, item.envelope.messageId);
      this.store.messageProcessing.markCompleted(item.envelope.messageId);
    } finally {
      stopTyping();
    }
  }

  private async handleResolvedMessage(item: QueuedMessage): Promise<void> {
    if (!shouldProcessMessage(item.envelope, item.watchLocation)) {
      return;
    }

    const routed = await this.harnessRunner.routeMessage({
      envelope: item.envelope,
      watchLocation: item.watchLocation,
      actorRole: item.actorRole,
      scope: item.scope
    });
    await this.dispatchHarnessResponse(item, routed.response, routed.codexThreadId);
  }

  private async processKnowledgeIngest(
    item: QueuedMessage,
    response: HarnessResponse,
    codexThreadId: string
  ): Promise<void> {
    if (item.envelope.urls.length === 0) {
      return;
    }

    const targetThread = await this.resolveKnowledgeThread(item);
    this.store.codexSessions.upsert(targetThread.id, codexThreadId);
    this.harnessRunner.persistKnowledgeResult({
      envelope: item.envelope,
      watchLocation: item.watchLocation,
      actorRole: item.actorRole,
      scope: item.scope,
      replyThreadId: targetThread.id,
      response
    });

    await targetThread.send({
      content: buildPlainTextReply(buildKnowledgeReplyText(response)),
      allowedMentions: {
        parse: []
      }
    });
  }

  private async dispatchHarnessResponse(
    item: QueuedMessage,
    response: HarnessResponse,
    codexThreadId: string
  ): Promise<void> {
    switch (response.outcome) {
      case "ignore":
        return;
      case "admin_diagnostics":
        await this.replyInSamePlace(
          item,
          buildAdminDiagnosticsReply({
            messageId: item.envelope.messageId,
            placeMode: item.watchLocation.mode,
            actorRole: item.actorRole,
            resolvedScope: item.scope,
            codexThreadId,
            notes: response.diagnostics.notes
          })
        );
        return;
      case "knowledge_ingest":
        await this.processKnowledgeIngest(item, response, codexThreadId);
        return;
      case "chat_reply":
        if (response.reply_mode === "no_reply") {
          return;
        }
        if (response.public_text?.trim()) {
          await this.replyInSamePlace(item, buildPlainTextReply(response.public_text));
        }
        return;
      case "failure":
        if (response.public_text?.trim()) {
          await this.replyInSamePlace(item, buildPlainTextReply(response.public_text));
          return;
        }
        throw new Error(response.diagnostics.notes ?? "harness returned failure");
    }
  }

  private async replyInSamePlace(
    item: QueuedMessage,
    content: string
  ): Promise<void> {
    await item.message.reply({
      content,
      allowedMentions: {
        repliedUser: false
      }
    });
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

  private async fetchWatchBaseChannel(channelId: string): Promise<TextChannel | NewsChannel | null> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !isBaseWatchChannel(channel)) {
      return null;
    }
    return channel;
  }

  private async fetchActiveThreads(
    channel: TextChannel | NewsChannel
  ): Promise<AnyThreadChannel[]> {
    try {
      const fetched = await channel.threads.fetchActive();
      return [...fetched.threads.values()];
    } catch (error) {
      this.logger.warn(
        {
          channelId: channel.id,
          error: error instanceof Error ? error.message : String(error)
        },
        "failed to fetch active threads; continuing without thread catch-up"
      );
      return [];
    }
  }

  private async seedCursorIfMissing(
    channel: TextChannel | NewsChannel | AnyThreadChannel
  ): Promise<void> {
    if (this.store.channelCursors.get(channel.id)) {
      return;
    }

    const latest = await channel.messages.fetch({ limit: 1 });
    const latestMessage = latest.first();
    if (latestMessage) {
      this.store.channelCursors.upsert(channel.id, latestMessage.id);
    }
  }

  private async notifyPermanentFailure(
    item: QueuedMessage,
    error: unknown
  ): Promise<void> {
    const failureTarget = this.config.watchLocations.find(
      (location) =>
        location.guildId === item.watchLocation.guildId &&
        location.mode === "admin_control"
    );

    if (!failureTarget) {
      return;
    }

    const channel = await this.fetchWatchBaseChannel(failureTarget.channelId);
    if (!channel) {
      return;
    }

    const message = [
      "```json",
      JSON.stringify(
        {
          type: "permanent_failure",
          message_id: item.envelope.messageId,
          place_mode: item.watchLocation.mode,
          channel_id: item.envelope.channelId,
          error:
            error instanceof Error ? error.message : "unknown_error"
        },
        null,
        2
      ),
      "```"
    ].join("\n");

    await channel.send({
      content: message,
      allowedMentions: {
        parse: []
      }
    });
  }

  private async tryAddProcessingReaction(message: Message<true>): Promise<void> {
    try {
      await message.react("👀");
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: message.id
        },
        "failed to add processing reaction"
      );
    }
  }

  private startRuntimeLeaseHeartbeat(): void {
    this.runtimeLeaseTimer = setInterval(() => {
      const renewed = this.store.runtimeLock.renew(
        this.runtimeInstanceId,
        process.pid
      );
      if (renewed) {
        return;
      }

      this.logger.fatal(
        {
          instanceId: this.runtimeInstanceId,
          ownerPid: process.pid
        },
        "lost runtime lock; stopping bot process"
      );
      void this.stop().finally(() => {
        process.exit(1);
      });
    }, 10_000);
  }

  private startTypingIndicator(channel: GuildTextBasedChannel): () => void {
    let active = true;
    let timer: NodeJS.Timeout | null = null;

    const sendTyping = async (): Promise<void> => {
      try {
        await channel.sendTyping();
      } catch (error) {
        this.logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            channelId: channel.id
          },
          "failed to send typing indicator"
        );
      }
    };

    void sendTyping();
    timer = setInterval(() => {
      if (!active) {
        return;
      }
      void sendTyping();
    }, 8_000);

    return () => {
      active = false;
      if (timer) {
        clearInterval(timer);
      }
    };
  }
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

async function onceReady(client: Client): Promise<void> {
  if (client.isReady()) {
    return;
  }

  await new Promise<void>((resolve) => {
    client.once(Events.ClientReady, () => resolve());
  });
}

export function createApplication(config = loadConfig()): BotApplication {
  return new BotApplication(config);
}
