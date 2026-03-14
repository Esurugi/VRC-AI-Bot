import { randomUUID } from "node:crypto";
import { once } from "node:events";

import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Channel,
  type ChatInputCommandInteraction,
  type Message,
  type NewsChannel,
  type TextChannel
} from "discord.js";
import pino, { type Logger } from "pino";

import { CodexAppServerClient } from "../codex/app-server-client.js";
import { SessionManager } from "../codex/session-manager.js";
import { SessionPolicyResolver } from "../codex/session-policy.js";
import { DiscordModerationExecutor } from "../discord/moderation-executor.js";
import { buildSanctionStateChangeReply } from "./replies.js";
import { loadConfig } from "../config/load-config.js";
import type { AppConfig } from "../domain/types.js";
import { HarnessRunner } from "../harness/harness-runner.js";
import { OrderedMessageQueue } from "../queue/ordered-message-queue.js";
import { SqliteStore } from "../storage/database.js";
import { FailureClassifier } from "./failure-classifier.js";
import type {
  BotModerationIntegration,
  PostResponseModerationInput,
  SanctionNotificationPayload
} from "./moderation-integration.js";
import { createBotModerationIntegration } from "./sanction-policy-service.js";
import { RetrySchedulerService } from "./retry-scheduler-service.js";
import { AdminCommandService } from "../runtime/admin/admin-command-service.js";
import { AdminOverrideBootstrapService } from "../runtime/admin/admin-override-bootstrap-service.js";
import { OverrideBootstrapPromptContextService } from "../runtime/admin/override-bootstrap-prompt-context-service.js";
import {
  buildOverrideCommandDefinitions,
  mergeOverrideCommandDefinitions
} from "../runtime/admin/admin-command-service.js";
import { ChatChannelCounterService } from "../runtime/chat/chat-channel-counter-service.js";
import { ChatEngagementPolicy } from "../runtime/chat/chat-engagement-policy.js";
import { ChatRuntimeControlService } from "../runtime/chat/chat-runtime-control-service.js";
import { RecentChatHistoryService } from "../runtime/chat/recent-chat-history-service.js";
import { ForumFirstTurnPreprocessor } from "../runtime/forum/forum-first-turn-preprocessor.js";
import { ForumResearchPlanner } from "../runtime/forum/forum-research-planner.js";
import { ForumThreadService } from "../runtime/forum/forum-thread-service.js";
import { MessageIntakeService } from "../runtime/message/message-intake-service.js";
import { MessageProcessingService } from "../runtime/message/message-processing-service.js";
import {
  findAdminControlWatchLocation,
  ReplyDispatchService,
  resolveKnowledgeIngestRouting
} from "../runtime/message/reply-dispatch-service.js";
import { RetryJobRunner } from "../runtime/scheduling/retry-job-runner.js";
import {
  resolveNextWeeklyMeetupAnnouncementAt,
  WeeklyMeetupAnnouncementService
} from "../runtime/scheduling/weekly-meetup-announcement-service.js";
import type { QueuedMessage, RoutedHarnessMessage } from "../runtime/types.js";

const RUNTIME_LOCK_LEASE_MS = 30_000;
const RUNTIME_LOCK_HEARTBEAT_MS = 10_000;

export {
  buildOverrideCommandDefinitions,
  findAdminControlWatchLocation,
  mergeOverrideCommandDefinitions,
  resolveKnowledgeIngestRouting
};

type BotApplicationDependencies = {
  client?: Client;
  logger?: Logger;
  store?: SqliteStore;
  codexClient?: CodexAppServerClient;
  sessionPolicyResolver?: SessionPolicyResolver;
  sessionManager?: SessionManager;
  harnessRunner?: HarnessRunner;
  failureClassifier?: FailureClassifier;
  retryScheduler?: RetrySchedulerService;
  moderationExecutor?: DiscordModerationExecutor;
  moderationIntegration?: BotModerationIntegration;
  replyDispatchService?: ReplyDispatchService;
  messageProcessingService?: MessageProcessingService;
  messageIntakeService?: MessageIntakeService;
  retryJobRunner?: RetryJobRunner;
  adminCommandService?: AdminCommandService;
  adminOverrideBootstrapService?: AdminOverrideBootstrapService;
  overrideBootstrapPromptContextService?: OverrideBootstrapPromptContextService;
  chatChannelCounterService?: ChatChannelCounterService;
  chatEngagementPolicy?: ChatEngagementPolicy;
  chatRuntimeControlService?: ChatRuntimeControlService;
  recentChatHistoryService?: RecentChatHistoryService;
  forumFirstTurnPreprocessor?: ForumFirstTurnPreprocessor;
  forumResearchPlanner?: ForumResearchPlanner;
  forumThreadService?: ForumThreadService;
  weeklyMeetupAnnouncementService?: WeeklyMeetupAnnouncementService;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  queue?: OrderedMessageQueue<QueuedMessage>;
};

export class BotApplication {
  private readonly client: Client;
  private readonly logger: Logger;
  readonly store: SqliteStore;
  private readonly codexClient: CodexAppServerClient;
  private readonly sessionPolicyResolver: SessionPolicyResolver;
  private readonly sessionManager: SessionManager;
  private readonly harnessRunner: HarnessRunner;
  private readonly failureClassifier: FailureClassifier;
  private readonly retryScheduler: RetrySchedulerService;
  private readonly moderationExecutor: DiscordModerationExecutor;
  private readonly moderationIntegration: BotModerationIntegration;
  private readonly replyDispatchService: ReplyDispatchService;
  private readonly messageProcessingService: MessageProcessingService;
  private readonly messageIntakeService: MessageIntakeService;
  private readonly retryJobRunner: RetryJobRunner;
  private readonly adminCommandService: AdminCommandService;
  private readonly adminOverrideBootstrapService: AdminOverrideBootstrapService;
  private readonly overrideBootstrapPromptContextService: OverrideBootstrapPromptContextService;
  private readonly chatChannelCounterService: ChatChannelCounterService;
  private readonly chatEngagementPolicy: ChatEngagementPolicy;
  private readonly chatRuntimeControlService: ChatRuntimeControlService;
  private readonly recentChatHistoryService: RecentChatHistoryService;
  private readonly forumFirstTurnPreprocessor: ForumFirstTurnPreprocessor;
  private readonly forumResearchPlanner: ForumResearchPlanner;
  private readonly forumThreadService: ForumThreadService;
  private readonly weeklyMeetupAnnouncementService: WeeklyMeetupAnnouncementService;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly queue: OrderedMessageQueue<QueuedMessage>;
  private readonly runtimeInstanceId = randomUUID();

  private started = false;
  private eventsBound = false;
  private leaseTimer: NodeJS.Timeout | null = null;
  private weeklyMeetupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    dependencies: BotApplicationDependencies = {}
  ) {
    this.logger =
      dependencies.logger ??
      pino({
        level: config.botLogLevel
      });
    this.store = dependencies.store ?? new SqliteStore(config.botDbPath, process.cwd());
    this.client =
      dependencies.client ??
      new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.MessageContent
        ]
      });
    this.codexClient =
      dependencies.codexClient ??
      new CodexAppServerClient(
        config.codexAppServerCommand,
        process.cwd(),
        config.codexHomePath,
        this.logger
      );
    this.sessionPolicyResolver =
      dependencies.sessionPolicyResolver ?? new SessionPolicyResolver();
    this.sessionManager =
      dependencies.sessionManager ??
      new SessionManager(this.store, this.codexClient, this.logger);
    this.forumResearchPlanner =
      dependencies.forumResearchPlanner ??
      new ForumResearchPlanner(this.codexClient, this.logger);
    this.forumFirstTurnPreprocessor =
      dependencies.forumFirstTurnPreprocessor ??
      new ForumFirstTurnPreprocessor(
        this.store,
        this.sessionPolicyResolver,
        this.logger
      );
    this.harnessRunner =
      dependencies.harnessRunner ??
      new HarnessRunner(
        this.store,
        this.codexClient,
        this.sessionPolicyResolver,
        this.sessionManager,
        this.forumResearchPlanner,
        this.logger
      );
    this.recentChatHistoryService =
      dependencies.recentChatHistoryService ??
      new RecentChatHistoryService(this.logger);
    this.failureClassifier =
      dependencies.failureClassifier ?? new FailureClassifier();
    this.retryScheduler =
      dependencies.retryScheduler ?? new RetrySchedulerService(this.store, this.logger);
    this.moderationExecutor =
      dependencies.moderationExecutor ??
      new DiscordModerationExecutor(this.client, this.logger);
    this.moderationIntegration =
      dependencies.moderationIntegration ??
      createBotModerationIntegration(this.store, this.logger);
    this.replyDispatchService =
      dependencies.replyDispatchService ??
      new ReplyDispatchService({
        store: this.store,
        harnessRunner: this.harnessRunner,
        sessionManager: this.sessionManager,
        sessionPolicyResolver: this.sessionPolicyResolver,
        watchLocations: config.watchLocations,
        logger: this.logger,
        fetchChannel: (channelId) => this.fetchChannel(channelId)
      });
    this.messageProcessingService =
      dependencies.messageProcessingService ??
      new MessageProcessingService(
        this.config,
        this.store,
        this.harnessRunner,
        this.forumFirstTurnPreprocessor,
        this.recentChatHistoryService,
        this.failureClassifier,
        this.retryScheduler,
        this.moderationIntegration,
        this.moderationExecutor,
        this.replyDispatchService,
        this.logger
      );
    this.queue =
      dependencies.queue ??
      new OrderedMessageQueue<QueuedMessage>((item) =>
        this.messageProcessingService.process(item)
      );
    this.chatChannelCounterService =
      dependencies.chatChannelCounterService ??
      new ChatChannelCounterService(this.store);
    this.chatEngagementPolicy =
      dependencies.chatEngagementPolicy ?? new ChatEngagementPolicy();
    this.chatRuntimeControlService =
      dependencies.chatRuntimeControlService ??
      new ChatRuntimeControlService(this.config.chatRuntimeControls ?? null);
    this.forumThreadService =
      dependencies.forumThreadService ?? new ForumThreadService();
    this.messageIntakeService =
      dependencies.messageIntakeService ??
      new MessageIntakeService(
        this.config,
        this.queue,
        this.chatChannelCounterService,
        this.chatEngagementPolicy,
        this.chatRuntimeControlService,
        this.forumThreadService,
        this.logger
      );
    this.adminOverrideBootstrapService =
      dependencies.adminOverrideBootstrapService ??
      new AdminOverrideBootstrapService(
        this.harnessRunner,
        this.replyDispatchService,
        this.failureClassifier,
        this.moderationIntegration,
        this.moderationExecutor,
        this.logger
      );
    this.overrideBootstrapPromptContextService =
      dependencies.overrideBootstrapPromptContextService ??
      new OverrideBootstrapPromptContextService(this.logger);
    this.retryJobRunner =
      dependencies.retryJobRunner ??
      new RetryJobRunner(
        this.config,
        this.client,
        this.store,
        this.retryScheduler,
        this.queue,
        this.replyDispatchService,
        this.messageProcessingService,
        this.logger
      );
    this.weeklyMeetupAnnouncementService =
      dependencies.weeklyMeetupAnnouncementService ??
      new WeeklyMeetupAnnouncementService(this.config, this.store, this.logger, {
        fetchChannel: (channelId) => this.fetchChannel(channelId)
      });
    this.adminCommandService =
      dependencies.adminCommandService ??
      new AdminCommandService(
        this.client,
        this.config,
        this.store,
        this.sessionManager,
        this.sessionPolicyResolver,
        this.adminOverrideBootstrapService,
        this.overrideBootstrapPromptContextService,
        this.weeklyMeetupAnnouncementService,
        this.logger
      );
    this.setTimeoutFn = dependencies.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = dependencies.clearTimeoutFn ?? clearTimeout;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.store.migrate();
    this.store.watchLocations.sync(this.config.watchLocations);
    if (
      !this.store.runtimeLock.tryAcquire(
        this.runtimeInstanceId,
        process.pid,
        RUNTIME_LOCK_LEASE_MS
      )
    ) {
      throw new Error("bot runtime lock is already held by another instance");
    }

    try {
      this.chatChannelCounterService.resetAll();
      await this.codexClient.start();
      this.bindEvents();
      await this.client.login(this.config.discordBotToken);
      if (!this.client.isReady()) {
        await once(this.client, Events.ClientReady);
      }
      await this.adminCommandService.registerCommands();
      this.startLeaseHeartbeat();
      await this.seedInitialCursors();
      await this.catchUpPendingMessages();
      await this.retryJobRunner.drainDueJobs();
      await this.weeklyMeetupAnnouncementService.poll(new Date());
      this.retryJobRunner.start();
      this.scheduleNextWeeklyMeetupAnnouncement(new Date());
      this.started = true;
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    this.retryJobRunner.stop();
    if (this.weeklyMeetupTimer) {
      this.clearTimeoutFn(this.weeklyMeetupTimer);
      this.weeklyMeetupTimer = null;
    }
    if (this.leaseTimer) {
      clearInterval(this.leaseTimer);
      this.leaseTimer = null;
    }

    try {
      this.store.runtimeLock.release(this.runtimeInstanceId);
    } catch {}

    await this.codexClient.close().catch(() => undefined);
    this.client.destroy();
    this.store.close();
  }

  private bindEvents(): void {
    if (this.eventsBound) {
      return;
    }

    this.client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message).catch((error) => {
        this.logger.error({ error }, "failed to intake discord message");
      });
    });
    this.client.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand()) {
        return;
      }
      void this.handleInteraction(interaction).catch((error) => {
        this.logger.error({ error }, "failed to process discord command interaction");
      });
    });
    this.eventsBound = true;
  }

  async handleMessage(message: Message): Promise<void> {
    await this.messageIntakeService.handle(message);
  }

  async processQueueItem(item: QueuedMessage): Promise<void> {
    await this.messageProcessingService.process(item);
  }

  async handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.adminCommandService.handle(interaction);
  }

  async replyInSamePlace(item: QueuedMessage, content: string): Promise<void> {
    await this.replyDispatchService.replyInSamePlace(item, content);
  }

  async fetchWatchBaseChannel(channelId: string): Promise<TextChannel | NewsChannel | null> {
    return this.replyDispatchService.fetchWatchBaseChannel(channelId);
  }

  async runSoftBlockPreflight(item: {
    envelope: QueuedMessage["envelope"];
    watchLocation: QueuedMessage["watchLocation"];
    actorRole: QueuedMessage["actorRole"];
    scope: QueuedMessage["scope"];
  }): Promise<boolean> {
    const decision = await this.moderationIntegration.checkSoftBlock(item);
    if (!decision.blocked) {
      return false;
    }

    if (decision.notice_text?.trim()) {
      await this.replyInSamePlace(item as QueuedMessage, decision.notice_text);
    }

    return true;
  }

  async notifySanctionStateChange(
    guildId: string,
    payload: SanctionNotificationPayload
  ): Promise<void> {
    const adminWatchLocation = findAdminControlWatchLocation(
      this.config.watchLocations,
      guildId
    );
    if (!adminWatchLocation) {
      return;
    }

    const channel = await this.fetchWatchBaseChannel(adminWatchLocation.channelId);
    if (!channel) {
      return;
    }

    await channel.send({
      content: buildSanctionStateChangeReply(payload),
      allowedMentions: { parse: [] }
    });
  }

  async runPostResponseModeration(
    item: {
      envelope: QueuedMessage["envelope"];
      watchLocation: QueuedMessage["watchLocation"];
      actorRole: QueuedMessage["actorRole"];
      scope: QueuedMessage["scope"];
    },
    routed: RoutedHarnessMessage | null
  ): Promise<void> {
    if (!routed || !this.moderationIntegration.afterResponse) {
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
    await this.moderationIntegration.afterResponse(callbackInput);
  }

  private async fetchChannel(channelId: string): Promise<Channel | null> {
    try {
      return await this.client.channels.fetch(channelId);
    } catch (error) {
      this.logger.debug(
        {
          channelId,
          error: error instanceof Error ? error.message : String(error)
        },
        "failed to fetch discord channel"
      );
      return null;
    }
  }

  private startLeaseHeartbeat(): void {
    if (this.leaseTimer) {
      clearInterval(this.leaseTimer);
    }

    this.leaseTimer = setInterval(() => {
      try {
        this.store.runtimeLock.renew(
          this.runtimeInstanceId,
          process.pid,
          RUNTIME_LOCK_LEASE_MS
        );
      } catch (error) {
        this.logger.warn(
          {
            error: error instanceof Error ? error.message : String(error)
          },
          "failed to renew bot runtime lock"
        );
      }
    }, RUNTIME_LOCK_HEARTBEAT_MS);
  }

  private scheduleNextWeeklyMeetupAnnouncement(now: Date): void {
    if (this.weeklyMeetupTimer) {
      this.clearTimeoutFn(this.weeklyMeetupTimer);
      this.weeklyMeetupTimer = null;
    }

    if (!this.config.weeklyMeetupAnnouncement) {
      return;
    }

    const nextAt = resolveNextWeeklyMeetupAnnouncementAt(now);
    const delayMs = Math.max(0, nextAt.getTime() - now.getTime());

    this.weeklyMeetupTimer = this.setTimeoutFn(() => {
      void this.runScheduledWeeklyMeetupAnnouncement(new Date());
    }, delayMs);
  }

  private async runScheduledWeeklyMeetupAnnouncement(now: Date): Promise<void> {
    try {
      await this.weeklyMeetupAnnouncementService.poll(now);
    } catch (error) {
      this.logger.error({ error }, "failed to poll weekly meetup announcement service");
    } finally {
      if (this.started) {
        this.scheduleNextWeeklyMeetupAnnouncement(now);
      }
    }
  }

  private async seedInitialCursors(): Promise<void> {
    for (const watchLocation of this.config.watchLocations) {
      if (this.store.channelCursors.get(watchLocation.channelId)) {
        continue;
      }

      const channel = await this.fetchChannel(watchLocation.channelId);
      if (!channel) {
        continue;
      }

      if (
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement
      ) {
        const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
        const latest = messages?.first();
        if (latest) {
          this.store.channelCursors.upsert(channel.id, latest.id);
        }
      }
    }
  }

  private async catchUpPendingMessages(): Promise<void> {
    // T09c: runtime seam only. Pending live catch-up remains intentionally deferred.
  }
}

export function createApplication(config = loadConfig()): BotApplication {
  return new BotApplication(config);
}
