import { randomUUID } from "node:crypto";
import {
  ApplicationCommandDataResolvable,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
  ThreadAutoArchiveDuration,
  type AnyThreadChannel,
  type Channel,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type Message,
  type NewsChannel,
  type TextChannel
} from "discord.js";
import pino, { type Logger } from "pino";

import {
  buildAdminDiagnosticsReply,
  buildFailureNotice,
  buildPermanentFailureReply,
  buildPlainTextReply,
  buildSanctionStateChangeReply,
  splitPlainTextReplies
} from "./replies.js";
import {
  type BotModerationIntegration,
  type PostResponseModerationInput,
  type SanctionNotificationPayload
} from "./moderation-integration.js";
import {
  FailureClassifier,
  type FailurePublicCategory,
  type FailureStage
} from "./failure-classifier.js";
import { RetrySchedulerService } from "./retry-scheduler-service.js";
import { createBotModerationIntegration } from "./sanction-policy-service.js";
import { CodexAppServerClient } from "../codex/app-server-client.js";
import { SessionManager } from "../codex/session-manager.js";
import { SessionPolicyResolver } from "../codex/session-policy.js";
import { loadConfig } from "../config/load-config.js";
import {
  DiscordModerationExecutor,
  type ModerationExecutor
} from "../discord/moderation-executor.js";
import {
  buildMessageEnvelope,
  isEligibleMessage,
  resolveWatchLocation,
  shouldProcessMessage
} from "../discord/message-utils.js";
import { resolveActorRole, resolveScope } from "../discord/facts.js";
import { writeDiscordRuntimeSnapshot } from "../discord/runtime-facts.js";
import type { AppConfig, MessageEnvelope, Scope, WatchLocationConfig } from "../domain/types.js";
import {
  buildKnowledgeReplyText,
  HarnessRunner,
  type HarnessResolvedSession
} from "../harness/harness-runner.js";
import type { HarnessResponse } from "../harness/contracts.js";
import { DEFAULT_OVERRIDE_FLAGS, type OverrideFlags } from "../override/types.js";
import { OrderedMessageQueue } from "../queue/ordered-message-queue.js";
import { SqliteStore, type RetryJobRow } from "../storage/database.js";

type QueuedMessage = {
  messageId: string;
  orderingKey: string;
  source: "live" | "retry";
  message: Message<true>;
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
  actorRole: ReturnType<typeof resolveActorRole>;
  scope: Scope;
};

type RoutedHarnessMessage = Awaited<ReturnType<HarnessRunner["routeMessage"]>>;

type FailureReplyTarget = {
  channelId: string;
  threadId: string | null;
};

type StageFailureInput = {
  stage: FailureStage;
  error: unknown;
  replyTarget: FailureReplyTarget;
};

export type BotApplicationDependencies = {
  moderationIntegration?: BotModerationIntegration;
  moderationExecutor?: ModerationExecutor;
};

export class BotApplication {
  private static readonly retryPollIntervalMs = 30_000;

  private readonly logger: Logger;
  private readonly store: SqliteStore;
  private readonly codexClient: CodexAppServerClient;
  private readonly sessionPolicyResolver: SessionPolicyResolver;
  private readonly sessionManager: SessionManager;
  private readonly harnessRunner: HarnessRunner;
  private readonly failureClassifier: FailureClassifier;
  private readonly retryScheduler: RetrySchedulerService;
  private readonly moderationIntegration: BotModerationIntegration;
  private readonly moderationExecutor: ModerationExecutor;
  private readonly queue: OrderedMessageQueue<QueuedMessage>;
  private readonly client: Client;
  private readonly runtimeInstanceId = randomUUID();
  private runtimeLeaseTimer: NodeJS.Timeout | null = null;
  private retryPollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    dependencies: BotApplicationDependencies = {}
  ) {
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
    this.sessionPolicyResolver = new SessionPolicyResolver();
    this.sessionManager = new SessionManager(
      this.store,
      this.codexClient,
      this.logger
    );
    this.harnessRunner = new HarnessRunner(
      this.store,
      this.codexClient,
      this.sessionPolicyResolver,
      this.sessionManager,
      this.logger
    );
    this.failureClassifier = new FailureClassifier();
    this.retryScheduler = new RetrySchedulerService(this.store, this.logger);
    this.queue = new OrderedMessageQueue(async (item) => this.processQueueItem(item));
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    this.moderationExecutor =
      dependencies.moderationExecutor ??
      new DiscordModerationExecutor(this.client, this.logger);
    this.moderationIntegration =
      dependencies.moderationIntegration ??
      createBotModerationIntegration(this.store, this.logger);
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
    await this.registerAdminCommands();
    this.startRuntimeLeaseHeartbeat();
    await this.seedInitialCursors();
    await this.catchUpPendingMessages();
    await this.drainDueRetryJobs();
    this.startRetryScheduler();
  }

  async stop(): Promise<void> {
    if (this.retryPollTimer) {
      clearInterval(this.retryPollTimer);
      this.retryPollTimer = null;
    }
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

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) {
        return;
      }

      try {
        await this.handleCommand(interaction);
      } catch (error) {
        this.logger.error(
          {
            error,
            commandName: interaction.commandName
          },
          "failed to handle interaction"
        );
        await replyToInteraction(
          interaction,
          "コマンド処理に失敗しました。管理者制御チャンネルの permanent failure を確認してください。"
        ).catch(() => undefined);
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
      source: "live",
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
    const acquired = this.store.messageProcessing.tryAcquire(item.envelope.messageId, item.envelope.channelId, {
      allowPendingRetryAcquire: item.source === "retry"
    });
    if (acquired.status !== "acquired") {
      this.logger.info(
        {
          messageId: item.envelope.messageId,
          channelId: item.envelope.channelId,
          acquisitionState: acquired.status
        },
        "skipping duplicate message processing"
      );
      if (acquired.status === "already_completed") {
        this.store.channelCursors.upsert(item.envelope.channelId, item.envelope.messageId);
        this.retryScheduler.clear(item.envelope.messageId);
      }
      return;
    }

    const blocked = await this.runSoftBlockPreflight(item);
    if (blocked) {
      this.markMessageCompleted(item);
      return;
    }

    const stopTyping = this.startTypingIndicator(item.message.channel);
    try {
      let routed: RoutedHarnessMessage | null;
      let replyTarget = buildSamePlaceReplyTarget(item);
      try {
        routed = await this.resolveHarnessMessage(item);
      } catch (error) {
        await this.handleRuntimeFailure(item, {
          stage: "fetch_or_resolve",
          error,
          replyTarget: buildSamePlaceReplyTarget(item)
        });
        return;
      }

      try {
        replyTarget = await this.dispatchResolvedMessage(item, routed);
      } catch (error) {
        await this.handleRuntimeFailure(item, extractStageFailure(error, item, "dispatch"));
        return;
      }

      try {
        await this.runPostResponseModeration(item, routed);
      } catch (error) {
        await this.handleRuntimeFailure(item, {
          stage: "post_response",
          error,
          replyTarget
        });
        return;
      }

      this.markMessageCompleted(item);
    } catch (error) {
      this.logger.error({ error, messageId: item.envelope.messageId }, "queue item failed");
      await this.handleRuntimeFailure(item, {
        stage: "fetch_or_resolve",
        error,
        replyTarget: buildSamePlaceReplyTarget(item)
      });
    } finally {
      stopTyping();
    }
  }

  private async resolveHarnessMessage(item: QueuedMessage): Promise<RoutedHarnessMessage | null> {
    if (!shouldProcessMessage(item.envelope, item.watchLocation)) {
      return null;
    }

    const runtimeFacts = writeDiscordRuntimeSnapshot({
      message: item.message,
      watchLocation: item.watchLocation,
      actorRole: item.actorRole,
      scope: item.scope,
      requestId: item.envelope.messageId
    });
    const routed = await this.harnessRunner.routeMessage({
      envelope: item.envelope,
      watchLocation: item.watchLocation,
      actorRole: item.actorRole,
      scope: item.scope,
      discordRuntimeFactsPath: runtimeFacts.snapshotPath
    });
    return routed;
  }

  private async processKnowledgeIngest(
    item: QueuedMessage,
    response: HarnessResponse,
    session: HarnessResolvedSession,
    persistenceScope: Scope | null
  ): Promise<FailureReplyTarget> {
    const routing = resolveKnowledgeIngestRouting({
      isThreadMessage: item.message.channel.isThread(),
      watchMode: item.watchLocation.mode,
      replyMode: response.reply_mode,
      hasMessageUrls: item.envelope.urls.length > 0
    });

    if (routing.kind === "same_place") {
      if (persistenceScope) {
        this.harnessRunner.persistKnowledgeResult({
          envelope: item.envelope,
          watchLocation: item.watchLocation,
          actorRole: item.actorRole,
          scope: item.scope,
          persistenceScope,
          replyThreadId: item.message.channel.isThread() ? item.message.channel.id : null,
          response
        });
      }
      await this.replyInSamePlace(item, buildKnowledgeReplyText(response));
      return buildSamePlaceReplyTarget(item);
    }

    const targetThread = await this.resolveKnowledgeThread(item);
    const replyTarget = {
      channelId: targetThread.id,
      threadId: targetThread.id
    } satisfies FailureReplyTarget;
    try {
      this.sessionManager.bindSession(
        this.sessionPolicyResolver.resolveKnowledgeThreadConversation({
          threadId: targetThread.id
        }),
        session.threadId
      );
      if (persistenceScope) {
        this.harnessRunner.persistKnowledgeResult({
          envelope: item.envelope,
          watchLocation: item.watchLocation,
          actorRole: item.actorRole,
          scope: item.scope,
          persistenceScope,
          replyThreadId: targetThread.id,
          response
        });
      }

      await this.sendChunksToChannel(targetThread, buildKnowledgeReplyText(response));
      return replyTarget;
    } catch (error) {
      throw attachReplyTarget(error, replyTarget);
    }
  }

  private async dispatchResolvedMessage(
    item: QueuedMessage,
    routed: RoutedHarnessMessage | null
  ): Promise<FailureReplyTarget> {
    if (!routed) {
      return buildSamePlaceReplyTarget(item);
    }

    return this.dispatchHarnessResponse(
      item,
      routed.response,
      routed.session,
      routed.knowledgePersistenceScope
    );
  }

  private async dispatchHarnessResponse(
    item: QueuedMessage,
    response: HarnessResponse,
    session: HarnessResolvedSession,
    knowledgePersistenceScope: Scope | null
  ): Promise<FailureReplyTarget> {
    this.logger.debug(
      {
        messageId: item.envelope.messageId,
        channelId: item.envelope.channelId,
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
        return buildSamePlaceReplyTarget(item);
      case "admin_diagnostics":
        await this.replyInSamePlace(
          item,
          buildAdminDiagnosticsReply({
            messageId: item.envelope.messageId,
            placeMode: item.watchLocation.mode,
            actorRole: item.actorRole,
            resolvedScope: item.scope,
            codexThreadId: session.threadId,
            sessionIdentity: session.identity.sessionIdentity,
            workloadKind: session.identity.workloadKind,
            modelProfile: session.identity.modelProfile,
            runtimeContractVersion: session.identity.runtimeContractVersion,
            notes: response.diagnostics.notes
          })
        );
        return buildSamePlaceReplyTarget(item);
      case "knowledge_ingest":
        return this.processKnowledgeIngest(
          item,
          response,
          session,
          knowledgePersistenceScope
        );
      case "chat_reply":
        if (response.reply_mode === "no_reply") {
          return buildSamePlaceReplyTarget(item);
        }
        if (response.public_text?.trim()) {
          await this.replyInSamePlace(item, response.public_text);
        }
        return buildSamePlaceReplyTarget(item);
      case "failure":
        await this.replyInSamePlace(
          item,
          response.public_text?.trim() ? response.public_text : "AI処理に失敗しました。"
        );
        return buildSamePlaceReplyTarget(item);
    }
  }

  private async replyInSamePlace(
    item: QueuedMessage,
    content: string
  ): Promise<void> {
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
  }

  private async sendChunksToChannel(
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
    input: {
      guildId: string;
      messageId: string;
      placeMode: WatchLocationConfig["mode"];
      channelId: string;
      error: unknown;
      stage: FailureStage;
      category: FailurePublicCategory;
    }
  ): Promise<void> {
    const failureTarget = findAdminControlWatchLocation(
      this.config.watchLocations,
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

  private async handleRuntimeFailure(
    item: QueuedMessage,
    input: StageFailureInput
  ): Promise<void> {
    const existingRetry = this.store.retryJobs.get(item.envelope.messageId);
    const decision = this.failureClassifier.classify(input.error, {
      stage: input.stage,
      attemptCount: existingRetry?.attempt_count ?? 0,
      watchMode: item.watchLocation.mode
    });
    const notice = buildFailureNotice({
      category: decision.publicCategory,
      ...(decision.delayMs == null ? {} : { delayMs: decision.delayMs })
    });

    try {
      await this.notifyFailureInTarget(item, input.replyTarget, notice);
    } catch (notifyError) {
      this.logger.warn(
        {
          error:
            notifyError instanceof Error ? notifyError.message : String(notifyError),
          messageId: item.envelope.messageId,
          stage: input.stage,
          replyTarget: input.replyTarget
        },
        "failed to notify runtime failure in public target"
      );
    }

    if (decision.retryable) {
      this.retryScheduler.schedule({
        envelope: item.envelope,
        watchLocation: item.watchLocation,
        stage: input.stage,
        decision,
        replyChannelId: input.replyTarget.channelId,
        replyThreadId: input.replyTarget.threadId
      });
      return;
    }

    await this.notifyPermanentFailure({
      guildId: item.watchLocation.guildId,
      messageId: item.envelope.messageId,
      placeMode: item.watchLocation.mode,
      channelId: item.envelope.channelId,
      error: input.error,
      stage: input.stage,
      category: decision.publicCategory
    });
    this.markMessageCompleted(item);
  }

  private markMessageCompleted(item: QueuedMessage): void {
    this.markMessageCompletedById(item.envelope.messageId, item.envelope.channelId);
  }

  private markMessageCompletedById(messageId: string, channelId: string): void {
    this.retryScheduler.clear(messageId);
    this.store.messageProcessing.markCompleted(messageId);
    this.store.channelCursors.upsert(channelId, messageId);
  }

  private async notifyFailureInTarget(
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

  private async notifyFailureForRetryJob(
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

  private async fetchReplyChannel(
    channelId: string
  ): Promise<TextChannel | NewsChannel | AnyThreadChannel | null> {
    const channel = await this.client.channels.fetch(channelId);
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

  private startRetryScheduler(): void {
    if (this.retryPollTimer) {
      clearInterval(this.retryPollTimer);
    }

    this.retryPollTimer = setInterval(() => {
      void this.drainDueRetryJobs().catch((error) => {
        this.logger.error({ error }, "failed to drain due retry jobs");
      });
    }, BotApplication.retryPollIntervalMs);
  }

  private async drainDueRetryJobs(): Promise<void> {
    const dueJobs = this.retryScheduler.pollDueJobs();
    for (const job of dueJobs) {
      await this.enqueueRetryJob(job);
    }
  }

  private async enqueueRetryJob(job: RetryJobRow): Promise<void> {
    try {
      const retryItem = await this.fetchRetryQueuedMessage(job);
      const enqueued = this.queue.enqueue(retryItem);
      if (!enqueued) {
        this.logger.debug(
          {
            messageId: job.message_id,
            channelId: job.channel_id
          },
          "retry job already enqueued"
        );
      }
    } catch (error) {
      await this.handleRetryJobFailure(job, error);
    }
  }

  private async fetchRetryQueuedMessage(job: RetryJobRow): Promise<QueuedMessage> {
    const channel = await this.fetchReplyChannel(job.channel_id);
    if (!channel) {
      throw new Error("channel no longer available");
    }

    const message = await channel.messages.fetch(job.message_id);
    if (!message.inGuild()) {
      throw new Error("message no longer available");
    }

    const typedMessage = message as Message<true>;
    const watchLocation = resolveWatchLocation(typedMessage, this.config.watchLocations);
    if (!watchLocation) {
      throw new Error("watch location not found");
    }

    return {
      messageId: typedMessage.id,
      orderingKey: typedMessage.channelId,
      source: "retry",
      message: typedMessage,
      envelope: buildMessageEnvelope(typedMessage, watchLocation),
      watchLocation,
      actorRole: resolveActorRole(typedMessage, this.config.discordOwnerUserIds),
      scope: resolveScope(typedMessage, watchLocation)
    };
  }

  private async handleRetryJobFailure(
    job: RetryJobRow,
    error: unknown
  ): Promise<void> {
    const decision = this.failureClassifier.classify(error, {
      stage: "fetch_or_resolve",
      attemptCount: job.attempt_count,
      watchMode: job.place_mode
    });
    const notice = buildFailureNotice({
      category: decision.publicCategory,
      ...(decision.delayMs == null ? {} : { delayMs: decision.delayMs })
    });

    try {
      await this.notifyFailureForRetryJob(job, notice);
    } catch (notifyError) {
      this.logger.warn(
        {
          error:
            notifyError instanceof Error ? notifyError.message : String(notifyError),
          messageId: job.message_id,
          channelId: job.reply_channel_id,
          threadId: job.reply_thread_id
        },
        "failed to notify retry-job failure in public target"
      );
    }

    if (decision.retryable) {
      this.retryScheduler.schedule({
        envelope: buildSchedulerEnvelope(job),
        watchLocation: this.resolveRetryWatchLocation(job),
        stage: "fetch_or_resolve",
        decision,
        replyChannelId: job.reply_channel_id,
        replyThreadId: job.reply_thread_id
      });
      return;
    }

    await this.notifyPermanentFailure({
      guildId: job.guild_id,
      messageId: job.message_id,
      placeMode: job.place_mode,
      channelId: job.channel_id,
      error,
      stage: "fetch_or_resolve",
      category: decision.publicCategory
    });
    this.markMessageCompletedById(job.message_id, job.channel_id);
  }

  private resolveRetryWatchLocation(job: RetryJobRow): WatchLocationConfig {
    return (
      this.config.watchLocations.find(
        (location) =>
          location.guildId === job.guild_id && location.channelId === job.channel_id
      ) ?? {
        guildId: job.guild_id,
        channelId: job.channel_id,
        mode: job.place_mode,
        defaultScope: "server_public"
      }
    );
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

  private async registerAdminCommands(): Promise<void> {
    const guildIds = [...new Set(this.config.watchLocations.map((location) => location.guildId))];
    const commands = buildOverrideCommandDefinitions();

    for (const guildId of guildIds) {
      try {
        const guild = await this.client.guilds.fetch(guildId);
        const existingCommands = await guild.commands.fetch();
        await guild.commands.set(
          mergeOverrideCommandDefinitions([...existingCommands.values()], commands)
        );
      } catch (error) {
        this.logger.warn(
          {
            guildId,
            error: error instanceof Error ? error.message : String(error)
          },
          "failed to register admin commands"
        );
      }
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (
      interaction.commandName !== "override-start" &&
      interaction.commandName !== "override-end"
    ) {
      return;
    }

    if (!interaction.inCachedGuild()) {
      await replyToInteraction(interaction, "guild 内でのみ使える command です。");
      return;
    }

    const watchLocation = resolveCommandWatchLocation(
      interaction.channel,
      this.config.watchLocations
    );
    if (!watchLocation || watchLocation.mode !== "admin_control") {
      await replyToInteraction(
        interaction,
        "この command は configured `admin_control` root channel またはそこから開いた override thread でのみ使えます。"
      );
      return;
    }

    const actorRole = resolveInteractionActorRole(
      interaction,
      this.config.discordOwnerUserIds
    );
    if (actorRole === "user") {
      await replyToInteraction(
        interaction,
        "Administrator 権限を持つ owner/admin だけがこの command を使えます。"
      );
      return;
    }

    if (interaction.commandName === "override-start") {
      if (!interaction.channel || interaction.channel.isThread()) {
        await replyToInteraction(
          interaction,
          "この command は configured `admin_control` root channel でのみ使えます。実行すると dedicated override thread を開きます。"
        );
        return;
      }

      if (!isBaseWatchChannel(interaction.channel)) {
        await replyToInteraction(
          interaction,
          "override thread を開けるのは text/announcement の admin_control root channel だけです。"
        );
        return;
      }

      const startedAt = new Date().toISOString();
      const flags = readOverrideFlags(interaction);
      const overrideThread = await interaction.channel.threads.create({
        name: buildOverrideThreadName(interaction),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `override-start by ${interaction.user.id}`
      });
      this.store.overrideSessions.start({
        sessionId: randomUUID(),
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        grantedBy: interaction.user.id,
        scopePlaceId: overrideThread.id,
        flags,
        sandboxMode: "workspace-write",
        startedAt
      });
      await overrideThread.send({
        content:
          `override thread を開きました。sandbox=workspace-write flags=${summarizeOverrideFlags(flags)}\n` +
          "この thread では、override を開始した管理者本人の会話全体が workspace-write context です。\n" +
          "終了するときはこの thread で `/override-end` を実行してください。",
        allowedMentions: { parse: [] }
      });
      await replyToInteraction(
        interaction,
        `override thread を開きました。thread=<#${overrideThread.id}> sandbox=workspace-write flags=${summarizeOverrideFlags(flags)}`
      );
      return;
    }

    if (!interaction.channel?.isThread()) {
      await replyToInteraction(
        interaction,
        "この command は dedicated override thread 内でのみ使えます。"
      );
      return;
    }

    const scopePlaceId = interaction.channelId;
    const active = this.store.overrideSessions.getActive(
      interaction.guildId,
      scopePlaceId,
      interaction.user.id
    );
    if (!active) {
      await replyToInteraction(
        interaction,
        "この thread に終了対象の active override はありません。override を開いた管理者本人が同じ thread で実行してください。"
      );
      return;
    }

    const archivedWriteSession = await this.sessionManager.archiveSession(
      this.sessionPolicyResolver.resolveAdminOverrideThread({
        threadId: scopePlaceId,
        actorId: interaction.user.id
      })
    );

    const ended = this.store.overrideSessions.endActive({
      guildId: interaction.guildId,
      scopePlaceId,
      actorId: interaction.user.id,
      endedAt: new Date().toISOString(),
      endedBy: interaction.user.id,
      cleanupReason: null
    });
    if (!ended) {
      await replyToInteraction(
        interaction,
        "この thread に終了対象の active override はありません。"
      );
      return;
    }

    await replyToInteraction(
      interaction,
      `override を終了しました。thread=${scopePlaceId} sandbox=read-only この thread を archive します。`
    );
    if (!archivedWriteSession.archived) {
      this.logger.debug(
        {
          threadId: scopePlaceId,
          actorId: interaction.user.id
        },
        "override ended without a persisted workspace-write session binding"
      );
    }
    await interaction.channel.setArchived(true, `override-end by ${interaction.user.id}`);
  }

  private async runSoftBlockPreflight(item: QueuedMessage): Promise<boolean> {
    const decision = await this.moderationIntegration.checkSoftBlock({
      envelope: item.envelope,
      watchLocation: item.watchLocation,
      actorRole: item.actorRole,
      scope: item.scope
    });
    if (!decision.blocked) {
      return false;
    }

    if (decision.notice_text?.trim()) {
      await this.replyInSamePlace(item, decision.notice_text);
    }

    return true;
  }

  private async runPostResponseModeration(
    item: QueuedMessage,
    routed: RoutedHarnessMessage | null
  ): Promise<void> {
    if (!routed) {
      return;
    }

    const callbackInput: PostResponseModerationInput = {
      envelope: item.envelope,
      watchLocation: item.watchLocation,
      actorRole: item.actorRole,
      scope: item.scope,
      response: routed.response,
      session: routed.session,
      moderation_signal: routed.moderationSignal,
      violation_counter_suspended: routed.violationCounterSuspended,
      executeModeration: this.moderationExecutor,
      notifySanctionStateChange: async (payload) =>
        this.notifySanctionStateChange(item.watchLocation.guildId, payload)
    };
    await this.moderationIntegration.afterResponse?.(callbackInput);
  }

  private async notifySanctionStateChange(
    guildId: string,
    payload: SanctionNotificationPayload
  ): Promise<void> {
    const failureTarget = findAdminControlWatchLocation(
      this.config.watchLocations,
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

function buildSamePlaceReplyTarget(item: QueuedMessage): FailureReplyTarget {
  return {
    channelId: item.message.channelId,
    threadId: item.message.channel.isThread() ? item.message.channel.id : null
  };
}

function extractStageFailure(
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

function attachReplyTarget(
  error: unknown,
  replyTarget: FailureReplyTarget
): Error & { replyTarget: FailureReplyTarget } {
  const normalized =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : String(error));
  return Object.assign(normalized, { replyTarget });
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

function buildSchedulerEnvelope(job: RetryJobRow): MessageEnvelope {
  return {
    guildId: job.guild_id,
    channelId: job.channel_id,
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

export function mergeOverrideCommandDefinitions(
  existingCommands: Array<{
    name: string;
    toJSON(): unknown;
  }>,
  desiredCommands: ApplicationCommandDataResolvable[]
): ApplicationCommandDataResolvable[] {
  const desiredNames = new Set(
    desiredCommands.map((command) => {
      const resolved = command as { name?: string };
      if (!resolved.name) {
        throw new Error("override command definition is missing a name");
      }
      return resolved.name;
    })
  );

  return [
    ...existingCommands
      .filter((command) => !desiredNames.has(command.name))
      .map((command) => command.toJSON() as ApplicationCommandDataResolvable),
    ...desiredCommands
  ];
}

export function buildOverrideCommandDefinitions(): ApplicationCommandDataResolvable[] {
  return [
    new SlashCommandBuilder()
      .setName("override-start")
      .setDescription("Open a dedicated override thread for workspace-write self-modification")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addBooleanOption((option) =>
        option
          .setName("allow_playwright_headed")
          .setDescription("Allow headed Playwright for this override")
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName("allow_playwright_persistent")
          .setDescription("Allow persistent Playwright profile for this override")
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName("allow_prompt_injection_test")
          .setDescription("Allow prompt-injection testing for this override")
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName("suspend_violation_counter")
          .setDescription("Suspend violation counter in this place during override")
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName("allow_private_external_fetch")
          .setDescription("Allow external fetch in private context without private terms")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("override-end")
      .setDescription("Close this override thread and return it to read-only mode")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON()
  ];
}

function resolveInteractionActorRole(
  interaction: ChatInputCommandInteraction,
  ownerUserIds: string[]
): "owner" | "admin" | "user" {
  if (ownerUserIds.includes(interaction.user.id)) {
    return "owner";
  }

  if (
    interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)
  ) {
    return "admin";
  }

  return "user";
}

function resolveCommandWatchLocation(
  channel: Channel | null,
  watchLocations: WatchLocationConfig[]
): WatchLocationConfig | null {
  if (!channel) {
    return null;
  }

  const direct = watchLocations.find((location) => location.channelId === channel.id);
  if (direct) {
    return direct;
  }

  if (channel.isThread()) {
    return (
      watchLocations.find((location) => location.channelId === channel.parentId) ?? null
    );
  }

  return null;
}

function buildOverrideThreadName(interaction: ChatInputCommandInteraction): string {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  return `override-${interaction.user.username}-${stamp}`.slice(0, 100);
}

function readOverrideFlags(interaction: ChatInputCommandInteraction): OverrideFlags {
  return {
    allowPlaywrightHeaded:
      interaction.options.getBoolean("allow_playwright_headed") ??
      DEFAULT_OVERRIDE_FLAGS.allowPlaywrightHeaded,
    allowPlaywrightPersistent:
      interaction.options.getBoolean("allow_playwright_persistent") ??
      DEFAULT_OVERRIDE_FLAGS.allowPlaywrightPersistent,
    allowPromptInjectionTest:
      interaction.options.getBoolean("allow_prompt_injection_test") ??
      DEFAULT_OVERRIDE_FLAGS.allowPromptInjectionTest,
    suspendViolationCounterForCurrentThread:
      interaction.options.getBoolean("suspend_violation_counter") ??
      DEFAULT_OVERRIDE_FLAGS.suspendViolationCounterForCurrentThread,
    allowExternalFetchInPrivateContextWithoutPrivateTerms:
      interaction.options.getBoolean("allow_private_external_fetch") ??
      DEFAULT_OVERRIDE_FLAGS.allowExternalFetchInPrivateContextWithoutPrivateTerms
  };
}

function summarizeOverrideFlags(flags: OverrideFlags): string {
  const enabled = Object.entries(flags)
    .filter(([, value]) => value)
    .map(([key]) => key);

  return enabled.length > 0 ? enabled.join(",") : "none";
}

async function replyToInteraction(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content,
      allowedMentions: { parse: [] }
    });
    return;
  }

  await interaction.reply({
    content,
    allowedMentions: { parse: [] }
  });
}

export function createApplication(
  config = loadConfig(),
  dependencies: BotApplicationDependencies = {}
): BotApplication {
  return new BotApplication(config, dependencies);
}



