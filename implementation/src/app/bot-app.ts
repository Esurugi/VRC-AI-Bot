import { randomUUID } from "node:crypto";
import { once } from "node:events";

import {
  ChannelType,
  Events,
  type Channel,
  type ChatInputCommandInteraction,
  type Message,
  type NewsChannel,
  type TextChannel
} from "discord.js";

import {
  createBotApplicationDependencies,
  type BotApplicationDependencies,
  type BotApplicationResolvedDependencies
} from "./bot-application-dependencies.js";
import { loadConfig } from "../config/load-config.js";
import type { AppConfig } from "../domain/types.js";
import {
  buildOverrideCommandDefinitions,
  mergeOverrideCommandDefinitions
} from "../runtime/admin/admin-command-service.js";
import { buildSanctionStateChangeReply } from "../runtime/message/replies.js";
import {
  findAdminControlWatchLocation,
  ReplyDispatchService,
  resolveKnowledgeIngestRouting
} from "../runtime/message/reply-dispatch-service.js";
import type {
  PostResponseModerationInput,
  SanctionNotificationPayload
} from "../runtime/moderation/moderation-integration.js";
import { resolveNextWeeklyMeetupAnnouncementAt } from "../runtime/scheduling/weekly-meetup-announcement-service.js";
import type { QueuedMessage, RoutedHarnessMessage } from "../runtime/types.js";

const RUNTIME_LOCK_LEASE_MS = 30_000;
const RUNTIME_LOCK_HEARTBEAT_MS = 10_000;

export {
  buildOverrideCommandDefinitions,
  findAdminControlWatchLocation,
  mergeOverrideCommandDefinitions,
  resolveKnowledgeIngestRouting
};

export class BotApplication {
  private readonly client: BotApplicationResolvedDependencies["client"];
  private readonly logger: BotApplicationResolvedDependencies["logger"];
  readonly store: BotApplicationResolvedDependencies["store"];
  private readonly codexClient: BotApplicationResolvedDependencies["codexClient"];
  private readonly sessionPolicyResolver: BotApplicationResolvedDependencies["sessionPolicyResolver"];
  private readonly sessionManager: BotApplicationResolvedDependencies["sessionManager"];
  private readonly harnessRunner: BotApplicationResolvedDependencies["harnessRunner"];
  private readonly failureClassifier: BotApplicationResolvedDependencies["failureClassifier"];
  private readonly retryScheduler: BotApplicationResolvedDependencies["retryScheduler"];
  private readonly moderationExecutor: BotApplicationResolvedDependencies["moderationExecutor"];
  private readonly moderationIntegration: BotApplicationResolvedDependencies["moderationIntegration"];
  private readonly replyDispatchService: BotApplicationResolvedDependencies["replyDispatchService"];
  private readonly messageProcessingService: BotApplicationResolvedDependencies["messageProcessingService"];
  private readonly messageIntakeService: BotApplicationResolvedDependencies["messageIntakeService"];
  private readonly startupMessageRecoveryService: BotApplicationResolvedDependencies["startupMessageRecoveryService"];
  private readonly retryJobRunner: BotApplicationResolvedDependencies["retryJobRunner"];
  private readonly adminCommandService: BotApplicationResolvedDependencies["adminCommandService"];
  private readonly adminOverrideBootstrapService: BotApplicationResolvedDependencies["adminOverrideBootstrapService"];
  private readonly overrideBootstrapPromptContextService: BotApplicationResolvedDependencies["overrideBootstrapPromptContextService"];
  private readonly chatChannelCounterService: BotApplicationResolvedDependencies["chatChannelCounterService"];
  private readonly chatEngagementPolicy: BotApplicationResolvedDependencies["chatEngagementPolicy"];
  private readonly chatRuntimeControlService: BotApplicationResolvedDependencies["chatRuntimeControlService"];
  private readonly recentChatHistoryService: BotApplicationResolvedDependencies["recentChatHistoryService"];
  private readonly forumFirstTurnPreprocessor: BotApplicationResolvedDependencies["forumFirstTurnPreprocessor"];
  private readonly forumResearchPromptRefiner: BotApplicationResolvedDependencies["forumResearchPromptRefiner"];
  private readonly forumResearchSupervisor: BotApplicationResolvedDependencies["forumResearchSupervisor"];
  private readonly featureThreadService: BotApplicationResolvedDependencies["featureThreadService"];
  private readonly plainTextAttachmentService: BotApplicationResolvedDependencies["plainTextAttachmentService"];
  private readonly weeklyMeetupAnnouncementService: BotApplicationResolvedDependencies["weeklyMeetupAnnouncementService"];
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly queue: BotApplicationResolvedDependencies["queue"];
  private readonly runtimeInstanceId = randomUUID();

  private started = false;
  private eventsBound = false;
  private leaseTimer: NodeJS.Timeout | null = null;
  private weeklyMeetupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    dependencies: BotApplicationDependencies = {}
  ) {
    const resolvedDependencies = createBotApplicationDependencies(
      config,
      dependencies,
      {
        fetchChannel: (channelId) => this.fetchChannel(channelId)
      }
    );

    this.client = resolvedDependencies.client;
    this.logger = resolvedDependencies.logger;
    this.store = resolvedDependencies.store;
    this.codexClient = resolvedDependencies.codexClient;
    this.sessionPolicyResolver = resolvedDependencies.sessionPolicyResolver;
    this.sessionManager = resolvedDependencies.sessionManager;
    this.harnessRunner = resolvedDependencies.harnessRunner;
    this.failureClassifier = resolvedDependencies.failureClassifier;
    this.retryScheduler = resolvedDependencies.retryScheduler;
    this.moderationExecutor = resolvedDependencies.moderationExecutor;
    this.moderationIntegration = resolvedDependencies.moderationIntegration;
    this.replyDispatchService = resolvedDependencies.replyDispatchService;
    this.messageProcessingService =
      resolvedDependencies.messageProcessingService;
    this.messageIntakeService = resolvedDependencies.messageIntakeService;
    this.startupMessageRecoveryService =
      resolvedDependencies.startupMessageRecoveryService;
    this.retryJobRunner = resolvedDependencies.retryJobRunner;
    this.adminCommandService = resolvedDependencies.adminCommandService;
    this.adminOverrideBootstrapService =
      resolvedDependencies.adminOverrideBootstrapService;
    this.overrideBootstrapPromptContextService =
      resolvedDependencies.overrideBootstrapPromptContextService;
    this.chatChannelCounterService =
      resolvedDependencies.chatChannelCounterService;
    this.chatEngagementPolicy = resolvedDependencies.chatEngagementPolicy;
    this.chatRuntimeControlService =
      resolvedDependencies.chatRuntimeControlService;
    this.recentChatHistoryService =
      resolvedDependencies.recentChatHistoryService;
    this.forumFirstTurnPreprocessor =
      resolvedDependencies.forumFirstTurnPreprocessor;
    this.forumResearchPromptRefiner =
      resolvedDependencies.forumResearchPromptRefiner;
    this.forumResearchSupervisor =
      resolvedDependencies.forumResearchSupervisor;
    this.featureThreadService = resolvedDependencies.featureThreadService;
    this.plainTextAttachmentService =
      resolvedDependencies.plainTextAttachmentService;
    this.weeklyMeetupAnnouncementService =
      resolvedDependencies.weeklyMeetupAnnouncementService;
    this.setTimeoutFn = resolvedDependencies.setTimeoutFn;
    this.clearTimeoutFn = resolvedDependencies.clearTimeoutFn;
    this.queue = resolvedDependencies.queue;
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
    this.startLeaseHeartbeat();

    try {
      this.chatChannelCounterService.resetAll();
      await this.codexClient.start();
      this.bindEvents();
      await this.client.login(this.config.discordBotToken);
      if (!this.client.isReady()) {
        await once(this.client, Events.ClientReady);
      }
      await this.adminCommandService.registerCommands();
      await this.seedInitialCursors();
      await this.startupMessageRecoveryService.recoverPendingMessages();
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
}

export function createApplication(config = loadConfig()): BotApplication {
  return new BotApplication(config);
}
