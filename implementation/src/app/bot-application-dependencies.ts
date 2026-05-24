import { Client, GatewayIntentBits, type Channel } from "discord.js";
import pino, { type Logger } from "pino";

import { CodexAppServerClient } from "../codex/app-server-client.js";
import { SessionManager } from "../codex/session-manager.js";
import { SessionPolicyResolver } from "../codex/session-policy.js";
import { loadConfig } from "../config/load-config.js";
import { DiscordModerationExecutor } from "../discord/moderation-executor.js";
import type { AppConfig } from "../domain/types.js";
import { HarnessRunner } from "../harness/harness-runner.js";
import { OrderedMessageQueue } from "../queue/ordered-message-queue.js";
import { AdminCommandService } from "../runtime/admin/admin-command-service.js";
import { AdminOverrideBootstrapService } from "../runtime/admin/admin-override-bootstrap-service.js";
import { OverrideBootstrapPromptContextService } from "../runtime/admin/override-bootstrap-prompt-context-service.js";
import { ChatChannelCounterService } from "../runtime/chat/chat-channel-counter-service.js";
import { ChatEngagementPolicy } from "../runtime/chat/chat-engagement-policy.js";
import { ChatRuntimeControlService } from "../runtime/chat/chat-runtime-control-service.js";
import { RecentChatHistoryService } from "../runtime/chat/recent-chat-history-service.js";
import { ClearExplanationRoutingGate } from "../runtime/clear-explanation/clear-explanation-routing-gate.js";
import { FailureClassifier } from "../runtime/failure/failure-classifier.js";
import { ForumFirstTurnPreprocessor } from "../runtime/forum/forum-first-turn-preprocessor.js";
import { ForumResearchPromptRefiner } from "../runtime/forum/forum-research-prompt-refiner.js";
import { ForumResearchSupervisor } from "../runtime/forum/forum-research-supervisor.js";
import { ForumThreadService } from "../runtime/forum/forum-thread-service.js";
import { MessageIntakeService } from "../runtime/message/message-intake-service.js";
import { MessageProcessingService } from "../runtime/message/message-processing-service.js";
import { PlainTextAttachmentService } from "../runtime/message/plain-text-attachment-service.js";
import { ReplyDispatchService } from "../runtime/message/reply-dispatch-service.js";
import type { BotModerationIntegration } from "../runtime/moderation/moderation-integration.js";
import { createBotModerationIntegration } from "../runtime/moderation/sanction-policy-service.js";
import { RetryJobRunner } from "../runtime/scheduling/retry-job-runner.js";
import { RetrySchedulerService } from "../runtime/scheduling/retry-scheduler-service.js";
import { StartupMessageRecoveryService } from "../runtime/message/startup-message-recovery-service.js";
import { WeeklyMeetupAnnouncementService } from "../runtime/scheduling/weekly-meetup-announcement-service.js";
import type { QueuedMessage } from "../runtime/types.js";
import { SqliteStore } from "../storage/database.js";

export type BotApplicationDependencies = {
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
  startupMessageRecoveryService?: StartupMessageRecoveryService;
  retryJobRunner?: RetryJobRunner;
  adminCommandService?: AdminCommandService;
  adminOverrideBootstrapService?: AdminOverrideBootstrapService;
  overrideBootstrapPromptContextService?: OverrideBootstrapPromptContextService;
  chatChannelCounterService?: ChatChannelCounterService;
  chatEngagementPolicy?: ChatEngagementPolicy;
  chatRuntimeControlService?: ChatRuntimeControlService;
  recentChatHistoryService?: RecentChatHistoryService;
  clearExplanationRoutingGate?: ClearExplanationRoutingGate;
  forumFirstTurnPreprocessor?: ForumFirstTurnPreprocessor;
  forumResearchPromptRefiner?: ForumResearchPromptRefiner;
  forumResearchSupervisor?: ForumResearchSupervisor;
  forumThreadService?: ForumThreadService;
  plainTextAttachmentService?: PlainTextAttachmentService;
  weeklyMeetupAnnouncementService?: WeeklyMeetupAnnouncementService;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  queue?: OrderedMessageQueue<QueuedMessage>;
};

export type BotApplicationResolvedDependencies = Required<BotApplicationDependencies>;

type BotApplicationDependencyFactoryOptions = {
  fetchChannel: (channelId: string) => Promise<Channel | null>;
};

export function createBotApplicationDependencies(
  config: AppConfig = loadConfig(),
  dependencies: BotApplicationDependencies = {},
  options: BotApplicationDependencyFactoryOptions
): BotApplicationResolvedDependencies {
  const logger =
    dependencies.logger ??
    pino({
      level: config.botLogLevel
    });
  const store = dependencies.store ?? new SqliteStore(config.botDbPath, process.cwd());
  const client =
    dependencies.client ??
    new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
      ]
    });
  const codexClient =
    dependencies.codexClient ??
    new CodexAppServerClient(
      config.codexAppServerCommand,
      process.cwd(),
      config.codexHomePath,
      logger
    );
  const sessionPolicyResolver =
    dependencies.sessionPolicyResolver ?? new SessionPolicyResolver();
  const sessionManager =
    dependencies.sessionManager ?? new SessionManager(store, codexClient, logger);
  const forumResearchSupervisor =
    dependencies.forumResearchSupervisor ??
    new ForumResearchSupervisor(codexClient, logger);
  const forumResearchPromptRefiner =
    dependencies.forumResearchPromptRefiner ??
    new ForumResearchPromptRefiner(codexClient, logger);
  const forumFirstTurnPreprocessor =
    dependencies.forumFirstTurnPreprocessor ??
    new ForumFirstTurnPreprocessor(store, sessionPolicyResolver, logger);
  const harnessRunner =
    dependencies.harnessRunner ??
    new HarnessRunner(
      store,
      codexClient,
      sessionPolicyResolver,
      sessionManager,
      forumResearchPromptRefiner,
      forumResearchSupervisor,
      logger
    );
  const recentChatHistoryService =
    dependencies.recentChatHistoryService ?? new RecentChatHistoryService(logger);
  const failureClassifier = dependencies.failureClassifier ?? new FailureClassifier();
  const retryScheduler =
    dependencies.retryScheduler ?? new RetrySchedulerService(store, logger);
  const moderationExecutor =
    dependencies.moderationExecutor ?? new DiscordModerationExecutor(client, logger);
  const moderationIntegration =
    dependencies.moderationIntegration ?? createBotModerationIntegration(store, logger);
  const replyDispatchService =
    dependencies.replyDispatchService ??
    new ReplyDispatchService({
      store,
      harnessRunner,
      sessionManager,
      sessionPolicyResolver,
      watchLocations: config.watchLocations,
      logger,
      fetchChannel: options.fetchChannel
    });
  const chatEngagementPolicy =
    dependencies.chatEngagementPolicy ?? new ChatEngagementPolicy();
  const clearExplanationRoutingGate =
    dependencies.clearExplanationRoutingGate ??
    new ClearExplanationRoutingGate(store, codexClient, logger);
  const messageProcessingService =
    dependencies.messageProcessingService ??
    new MessageProcessingService(
      config,
      store,
      harnessRunner,
      forumFirstTurnPreprocessor,
      recentChatHistoryService,
      chatEngagementPolicy,
      clearExplanationRoutingGate,
      failureClassifier,
      retryScheduler,
      moderationIntegration,
      moderationExecutor,
      replyDispatchService,
      logger
    );
  const queue =
    dependencies.queue ??
    new OrderedMessageQueue<QueuedMessage>((item) =>
      messageProcessingService.process(item)
    );
  const chatChannelCounterService =
    dependencies.chatChannelCounterService ?? new ChatChannelCounterService(store);
  const chatRuntimeControlService =
    dependencies.chatRuntimeControlService ??
    new ChatRuntimeControlService(config.chatRuntimeControls ?? null);
  const forumThreadService = dependencies.forumThreadService ?? new ForumThreadService();
  const plainTextAttachmentService =
    dependencies.plainTextAttachmentService ?? new PlainTextAttachmentService(logger);
  const messageIntakeService =
    dependencies.messageIntakeService ??
    new MessageIntakeService(
      config,
      queue,
      chatChannelCounterService,
      chatEngagementPolicy,
      chatRuntimeControlService,
      forumThreadService,
      plainTextAttachmentService,
      logger
    );
  const startupMessageRecoveryService =
    dependencies.startupMessageRecoveryService ??
    new StartupMessageRecoveryService({
      watchLocations: config.watchLocations,
      store,
      fetchChannel: options.fetchChannel,
      messageIntakeService,
      logger
    });
  const adminOverrideBootstrapService =
    dependencies.adminOverrideBootstrapService ??
    new AdminOverrideBootstrapService(
      harnessRunner,
      replyDispatchService,
      failureClassifier,
      moderationIntegration,
      moderationExecutor,
      logger
    );
  const overrideBootstrapPromptContextService =
    dependencies.overrideBootstrapPromptContextService ??
    new OverrideBootstrapPromptContextService(logger);
  const retryJobRunner =
    dependencies.retryJobRunner ??
    new RetryJobRunner(
      config,
      client,
      store,
      retryScheduler,
      queue,
      replyDispatchService,
      messageProcessingService,
      plainTextAttachmentService,
      logger
    );
  const weeklyMeetupAnnouncementService =
    dependencies.weeklyMeetupAnnouncementService ??
    new WeeklyMeetupAnnouncementService(config, store, logger, {
      fetchChannel: options.fetchChannel
    });
  const adminCommandService =
    dependencies.adminCommandService ??
    new AdminCommandService(
      client,
      config,
      store,
      sessionManager,
      sessionPolicyResolver,
      adminOverrideBootstrapService,
      overrideBootstrapPromptContextService,
      weeklyMeetupAnnouncementService,
      logger
    );

  return {
    client,
    logger,
    store,
    codexClient,
    sessionPolicyResolver,
    sessionManager,
    harnessRunner,
    failureClassifier,
    retryScheduler,
    moderationExecutor,
    moderationIntegration,
    replyDispatchService,
    messageProcessingService,
    messageIntakeService,
    startupMessageRecoveryService,
    retryJobRunner,
    adminCommandService,
    adminOverrideBootstrapService,
    overrideBootstrapPromptContextService,
    chatChannelCounterService,
    chatEngagementPolicy,
    chatRuntimeControlService,
    recentChatHistoryService,
    clearExplanationRoutingGate,
    forumFirstTurnPreprocessor,
    forumResearchPromptRefiner,
    forumResearchSupervisor,
    forumThreadService,
    plainTextAttachmentService,
    weeklyMeetupAnnouncementService,
    setTimeoutFn: dependencies.setTimeoutFn ?? setTimeout,
    clearTimeoutFn: dependencies.clearTimeoutFn ?? clearTimeout,
    queue
  };
}
