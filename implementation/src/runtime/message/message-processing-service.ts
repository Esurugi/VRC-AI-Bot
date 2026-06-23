import type { GuildTextBasedChannel } from "discord.js";
import type { Logger } from "pino";

import type { FailureClassifier } from "../failure/failure-classifier.js";
import type {
  BotModerationIntegration,
  PostResponseModerationInput
} from "../moderation/moderation-integration.js";
import { buildFailureNotice } from "./replies.js";
import type { RetrySchedulerService } from "../scheduling/retry-scheduler-service.js";
import type { ModerationExecutor } from "../../discord/moderation-executor.js";
import { writeDiscordRuntimeSnapshot } from "../../discord/runtime-facts.js";
import {
  isClearExplanationPlace,
  isConversationPlace,
  isForumResearchPlace,
  isQuestionGatewayPlace
} from "../../domain/place-features.js";
import { isThreadEnvelope } from "../../domain/response-boundary.js";
import { resolveScope } from "../../discord/facts.js";
import type { AppConfig, WatchLocationConfig } from "../../domain/types.js";
import { HarnessRunner } from "../../harness/harness-runner.js";
import { appendRuntimeTrace } from "../../observability/runtime-trace.js";
import { RecentChatHistoryService } from "../chat/recent-chat-history-service.js";
import {
  ChatEngagementPolicy,
  type ChatEngagementEvaluation,
  toChatEngagementFact
} from "../chat/chat-engagement-policy.js";
import { FeatureThreadService } from "../thread/feature-thread-service.js";
import {
  ForumFirstTurnPreprocessor,
  type ForumFirstTurnPreparation
} from "../forum/forum-first-turn-preprocessor.js";
import {
  CLEAR_EXPLANATION_DECLINE_NOTICE,
  ClearExplanationRoutingGate,
  buildClearExplanationQuestionGatewayRedirectNotice
} from "../clear-explanation/clear-explanation-routing-gate.js";
import {
  ThreadWorkflowGateway
} from "../thread/thread-workflow-gateway.js";
import { WorkflowSwitchRerunService } from "../thread/workflow-switch-rerun-service.js";
import { SqliteStore, type RetryJobRow } from "../../storage/database.js";
import type { ThreadWorkflow } from "../../storage/types.js";
import {
  buildRetrySchedulerEnvelope,
  buildSamePlaceReplyTarget,
  resolveRetryWatchLocation,
  type QueuedMessage,
  type RoutedHarnessMessage,
  type StageFailureInput
} from "../types.js";
import { ReplyDispatchService } from "./reply-dispatch-service.js";
import { shouldShowTypingIndicator } from "./processing-visibility.js";

type TypingIndicatorController = {
  pulseNow: (
    reason:
      | "startup"
      | "heartbeat"
      | "progress_notice"
      | "retry_status"
      | "retry_stream"
      | "final_stream"
  ) => Promise<void>;
  stop: () => void;
};

type ProcessingAdmission =
  | {
      decision: "handle";
      chatEngagement: QueuedMessage["chatEngagement"];
    }
  | {
      decision: "ignore";
    };

export class MessageProcessingService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: SqliteStore,
    private readonly harnessRunner: HarnessRunner,
    private readonly forumFirstTurnPreprocessor: ForumFirstTurnPreprocessor,
    private readonly recentChatHistoryService: RecentChatHistoryService,
    private readonly chatEngagementPolicy: ChatEngagementPolicy,
    private readonly featureThreadService: FeatureThreadService,
    private readonly clearExplanationRoutingGate: ClearExplanationRoutingGate,
    private readonly failureClassifier: FailureClassifier,
    private readonly retryScheduler: RetrySchedulerService,
    private readonly moderationIntegration: BotModerationIntegration,
    private readonly moderationExecutor: ModerationExecutor,
    private readonly replyDispatchService: ReplyDispatchService,
    private readonly logger: Logger,
    private readonly threadWorkflowGateway?: ThreadWorkflowGateway,
    private readonly workflowSwitchRerunService?: WorkflowSwitchRerunService
  ) {}

  async process(item: QueuedMessage): Promise<void> {
    if (
      isClearExplanationPlace(item.watchLocation) &&
      !isThreadEnvelope(item.envelope)
    ) {
      return;
    }

    const acquired = this.store.messageProcessing.tryAcquire(
      item.envelope.messageId,
      item.envelope.channelId,
      {
        allowPendingRetryAcquire: item.source === "retry"
      }
    );
    if (acquired.status !== "acquired") {
      this.logger.info(
        {
          messageId: item.envelope.messageId,
          channelId: item.envelope.channelId,
          acquisitionState: acquired.status
        },
        "skipping duplicate message processing"
      );
      if (
        acquired.status === "already_completed" ||
        acquired.status === "already_terminal_failure_notified"
      ) {
        this.store.channelCursors.upsert(item.envelope.channelId, item.envelope.messageId);
        this.retryScheduler.clear(item.envelope.messageId);
      }
      return;
    }

    if (item.source === "workflow_switch_rerun") {
      this.workflowSwitchRerunService?.clearRerunRequest(item.envelope.messageId);
    }

    const admission = await this.resolveProcessingAdmission(item);
    if (admission.decision === "ignore") {
      this.markMessageCompleted(item);
      return;
    }
    const admittedItem: QueuedMessage =
      admission.chatEngagement === item.chatEngagement
        ? item
        : {
            ...item,
            chatEngagement: admission.chatEngagement
          };

    const blocked = await this.runSoftBlockPreflight(admittedItem);
    if (blocked) {
      this.markMessageCompleted(admittedItem);
      return;
    }

    const routedItem = await this.resolveThreadWorkflowRouteIfNeeded(admittedItem);
    if (!routedItem) {
      this.markMessageCompleted(admittedItem);
      return;
    }

    const releaseWorkflowSwitchActive =
      this.workflowSwitchRerunService?.trackActive(routedItem) ?? (() => undefined);
    const typingIndicator = shouldShowTypingIndicator({
      watchLocation: routedItem.watchLocation,
      chatEngagement: routedItem.chatEngagement
    })
      ? isForumResearchPlace(routedItem.watchLocation)
        ? this.startTypingIndicator(routedItem.message.channel, {
            owner: "forum_high_thinking",
            messageId: routedItem.envelope.messageId,
            channelId: routedItem.envelope.channelId
          })
        : this.startTypingIndicator(routedItem.message.channel, {
            owner: "message_processing",
            messageId: routedItem.envelope.messageId,
            channelId: routedItem.envelope.channelId
          })
      : createNoopTypingIndicator();
    try {
      let routed: RoutedHarnessMessage | null;
      let replyTarget = buildSamePlaceReplyTarget(item);
      let forumBootstrap: ForumFirstTurnPreparation;
      try {
        const redirected = await this.redirectClearExplanationIfNeeded(routedItem, {
          runRouteGate: !isQuestionGatewayPlace(admittedItem.watchLocation)
        });
        if (this.shouldStopForWorkflowSwitchRerun(routedItem)) {
          return;
        }
        if (redirected) {
          this.markMessageCompleted(routedItem);
          return;
        }

        forumBootstrap =
          await this.forumFirstTurnPreprocessor.resolveEffectiveContentOverride({
            message: routedItem.message,
            envelope: routedItem.envelope,
            watchLocation: routedItem.watchLocation,
            actorRole: routedItem.actorRole,
            scope: routedItem.scope
        });
        routed = await this.resolveHarnessMessage(
          routedItem,
          forumBootstrap,
          typingIndicator,
          admission
        );
        if (this.shouldStopForWorkflowSwitchRerun(routedItem)) {
          return;
        }
      } catch (error) {
        if (this.shouldStopForWorkflowSwitchRerun(routedItem)) {
          return;
        }
        await this.handleRuntimeFailure(routedItem, {
          stage: "fetch_or_resolve",
          error,
          replyTarget: buildSamePlaceReplyTarget(routedItem)
        });
        return;
      }

      try {
        replyTarget = await this.replyDispatchService.dispatchResolvedMessage(routedItem, routed);
        if (this.shouldStopForWorkflowSwitchRerun(routedItem)) {
          return;
        }
      } catch (error) {
        if (this.shouldStopForWorkflowSwitchRerun(routedItem)) {
          return;
        }
        await this.handleRuntimeFailure(routedItem, extractStageFailure(error, routedItem, "dispatch"));
        return;
      }

      try {
        await this.runPostResponseModeration(routedItem, routed);
      } catch (error) {
        if (this.shouldStopForWorkflowSwitchRerun(routedItem)) {
          return;
        }
        await this.handleRuntimeFailure(routedItem, {
          stage: "post_response",
          error,
          replyTarget
        });
        return;
      }

      this.markMessageCompleted(routedItem);
    } catch (error) {
      if (this.shouldStopForWorkflowSwitchRerun(routedItem)) {
        return;
      }
      this.logger.error({ error, messageId: routedItem.envelope.messageId }, "queue item failed");
      await this.handleRuntimeFailure(routedItem, {
        stage: "fetch_or_resolve",
        error,
        replyTarget: buildSamePlaceReplyTarget(routedItem)
      });
    } finally {
      typingIndicator.stop();
      releaseWorkflowSwitchActive();
    }
  }

  async resolveHarnessMessage(
    item: QueuedMessage,
    forumBootstrap: ForumFirstTurnPreparation | undefined,
    typingIndicator: TypingIndicatorController,
    processingAdmission?: ProcessingAdmission
  ): Promise<RoutedHarnessMessage | null> {
    const admission =
      processingAdmission ?? (await this.resolveProcessingAdmission(item));
    if (admission.decision === "ignore") {
      return null;
    }
    const resolvedForumBootstrap =
      forumBootstrap ??
      (await this.forumFirstTurnPreprocessor.resolveEffectiveContentOverride({
        message: item.message,
        envelope: item.envelope,
        watchLocation: item.watchLocation,
        actorRole: item.actorRole,
        scope: item.scope
      }));
    const runtimeFacts = writeDiscordRuntimeSnapshot({
      message: item.message,
      watchLocation: item.watchLocation,
      actorRole: item.actorRole,
      scope: item.scope,
      requestId: item.envelope.messageId
    });
    const roomContext = await this.recentChatHistoryService.collect({
      message: item.message,
      watchLocation: item.watchLocation
    });
    return this.harnessRunner.routeMessage({
      envelope: item.envelope,
      watchLocation: item.watchLocation,
      actorRole: item.actorRole,
      scope: item.scope,
      discordRuntimeFactsPath: runtimeFacts.snapshotPath,
      effectiveContentOverride: resolvedForumBootstrap.preparedPrompt,
      chatEngagement: admission.chatEngagement,
      recentRoomEvents: roomContext.recentRoomEvents,
      forumStarterMessage: resolvedForumBootstrap.starterMessage,
      ...(isForumResearchPlace(item.watchLocation)
        ? {
            forumRetryCallbacks: this.buildForumCallbacks(
              item,
              typingIndicator
            )
          }
        : {})
    });
  }

  private async resolveProcessingAdmission(
    item: QueuedMessage
  ): Promise<ProcessingAdmission> {
    const featureThreadHandling = await this.featureThreadService.evaluateMessage(
      item.message,
      item.watchLocation
    );
    if (featureThreadHandling.decision === "ignore") {
      return {
        decision: "ignore"
      };
    }
    if (featureThreadHandling.decision === "handle") {
      return {
        decision: "handle",
        chatEngagement: toQueuedChatEngagement(featureThreadHandling.engagement)
      };
    }

    if (item.chatEngagement !== null) {
      return {
        decision: "handle",
        chatEngagement: item.chatEngagement
      };
    }

    return this.deriveChatEngagement(item);
  }

  private shouldStopForWorkflowSwitchRerun(item: QueuedMessage): boolean {
    return Boolean(
      item.source !== "workflow_switch_rerun" &&
        this.workflowSwitchRerunService?.isRerunRequested(item.envelope.messageId)
    );
  }

  private async resolveThreadWorkflowRouteIfNeeded(
    item: QueuedMessage
  ): Promise<QueuedMessage | null> {
    if (!this.threadWorkflowGateway) {
      return item;
    }

    const resolution = await this.threadWorkflowGateway.resolve({
      message: item.message,
      envelope: item.envelope,
      watchLocation: item.watchLocation
    });
    if (resolution.decision === "pass") {
      return item;
    }

    if (resolution.decision === "fail") {
      await this.replyDispatchService.sendFollowupInSamePlace(item, resolution.notice);
      return null;
    }

    return routeQueuedMessageToWorkflow(item, resolution.workflow);
  }

  private async deriveChatEngagement(
    item: QueuedMessage
  ): Promise<ProcessingAdmission> {
    if (!isConversationPlace(item.watchLocation)) {
      return {
        decision: "handle",
        chatEngagement: null
      };
    }

    const evaluation = await this.chatEngagementPolicy.evaluate({
      message: item.message,
      envelope: item.envelope,
      watchLocation: item.watchLocation
    });
    if (evaluation.decision !== "always") {
      return {
        decision: "ignore"
      };
    }
    return {
      decision: "handle",
      chatEngagement: toQueuedChatEngagement(evaluation)
    };
  }

  private async redirectClearExplanationIfNeeded(
    item: QueuedMessage,
    input: {
      runRouteGate: boolean;
    } = {
      runRouteGate: true
    }
  ): Promise<boolean> {
    if (
      !input.runRouteGate ||
      !isClearExplanationPlace(item.watchLocation) ||
      !isThreadEnvelope(item.envelope)
    ) {
      return false;
    }

    const decision = await this.clearExplanationRoutingGate.decide({
      envelope: item.envelope,
      watchLocation: item.watchLocation
    });
    if (decision === "allow_clear_explanation") {
      return false;
    }

    await this.replyDispatchService.sendFollowupInSamePlace(
      item,
      decision === "redirect_to_forum_research"
        ? buildClearExplanationQuestionGatewayRedirectNotice(
            this.config.watchLocations,
            item.watchLocation
          )
        : CLEAR_EXPLANATION_DECLINE_NOTICE
    );
    return true;
  }

  private buildForumCallbacks(
    item: QueuedMessage,
    typingIndicator: TypingIndicatorController
  ) {
    let retryStreamWriterPromise:
      | Promise<{
          append: (delta: string) => Promise<void>;
          complete: () => Promise<void>;
        }>
      | null = null;
    let finalStreamWriterPromise:
      | Promise<{
          append: (delta: string) => Promise<void>;
          complete: () => Promise<void>;
        }>
      | null = null;
    const sentStatuses = new Set<string>();
    const sentProgressNotices = new Set<string>();

    return {
      onProgressNotice: async (content: string) => {
        const normalized = content.trim();
        if (
          item.source !== "live" ||
          normalized.length === 0 ||
          sentProgressNotices.has(normalized)
        ) {
          return;
        }
        sentProgressNotices.add(normalized);
        await typingIndicator.pulseNow("progress_notice");
        await this.replyDispatchService.sendFollowupInSamePlace(item, content);
      },
      onRetryStatus: async (content: string) => {
        const normalized = content.trim();
        if (normalized.length === 0 || sentStatuses.has(normalized)) {
          return;
        }
        sentStatuses.add(normalized);
        await typingIndicator.pulseNow("retry_status");
        await this.replyDispatchService.sendFollowupInSamePlace(item, content);
      },
      onRetryStream: {
        onAgentMessageDelta: async (delta: string) => {
          await typingIndicator.pulseNow("retry_stream");
          retryStreamWriterPromise ??=
            this.replyDispatchService.createStreamingReplyInSamePlace(item);
          const writer = await retryStreamWriterPromise;
          await writer.append(delta);
        }
      },
      onRetryCompleted: async () => {
        if (!retryStreamWriterPromise) {
          return;
        }
        const writer = await retryStreamWriterPromise;
        await writer.complete();
      },
      onFinalTextDelta: async (delta: string) => {
        finalStreamWriterPromise ??=
          this.replyDispatchService.createStreamingReplyInSamePlace(item);
        const writer = await finalStreamWriterPromise;
        await writer.append(delta);
      },
      onFinalTextCompleted: async () => {
        if (!finalStreamWriterPromise) {
          return;
        }
        const writer = await finalStreamWriterPromise;
        await writer.complete();
      }
    };
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
      await this.replyDispatchService.notifyFailureInTarget(
        item,
        buildSamePlaceReplyTarget(item),
        decision.notice_text
      );
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
        this.replyDispatchService.notifySanctionStateChange(item.watchLocation.guildId, payload)
    };
    await this.moderationIntegration.afterResponse?.(callbackInput);
  }

  private async handleRuntimeFailure(
    item: QueuedMessage,
    input: StageFailureInput
  ): Promise<void> {
    if (isForumResearchPlace(item.watchLocation)) {
      await this.handleForumTerminalFailure({
        messageId: item.envelope.messageId,
        channelId: item.envelope.channelId,
        notify: async (notice) =>
          this.replyDispatchService.notifyFailureInTarget(item, input.replyTarget, notice)
      });
      this.markTerminalFailureNotified(item);
      return;
    }

    const existingRetry = this.store.retryJobs.get(item.envelope.messageId);
    const decision = this.failureClassifier.classify(input.error, {
      stage: input.stage,
      attemptCount: existingRetry?.attempt_count ?? 0
    });
    const notice = buildFailureNotice({
      category: decision.publicCategory,
      retryable: decision.retryable,
      ...(decision.delayMs == null ? {} : { delayMs: decision.delayMs })
    });

    try {
      await this.replyDispatchService.notifyFailureInTarget(item, input.replyTarget, notice);
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

    await this.replyDispatchService.notifyPermanentFailure({
      guildId: item.watchLocation.guildId,
      messageId: item.envelope.messageId,
      placeMode: item.watchLocation.mode,
      channelId: item.envelope.channelId,
      error: input.error,
      stage: input.stage,
      category: decision.publicCategory
    });
    this.markTerminalFailureNotified(item);
  }

  markMessageCompleted(item: QueuedMessage): void {
    this.markMessageCompletedById(item.envelope.messageId, item.envelope.channelId);
  }

  markMessageCompletedById(messageId: string, channelId: string): void {
    this.retryScheduler.clear(messageId);
    this.store.messageProcessing.markCompleted(messageId);
    this.store.channelCursors.upsert(channelId, messageId);
  }

  markTerminalFailureNotified(item: QueuedMessage): void {
    this.markTerminalFailureNotifiedById(
      item.envelope.messageId,
      item.envelope.channelId
    );
  }

  markTerminalFailureNotifiedById(messageId: string, channelId: string): void {
    this.retryScheduler.clear(messageId);
    this.store.messageProcessing.markTerminalFailureNotified(messageId);
    this.store.channelCursors.upsert(channelId, messageId);
  }

  async handleRetryJobFailure(
    item: RetryJobRow,
    error: unknown
  ): Promise<void> {
    const retryWatchLocation = this.resolveRetryJobWatchLocation(item);
    const isForumRetryJob = retryWatchLocation
      ? isForumResearchPlace(retryWatchLocation)
      : isLegacyForumRetryJobWithoutResolvedWatchLocation(item);
    if (isForumRetryJob) {
      await this.handleForumTerminalFailure({
        messageId: item.message_id,
        channelId: item.message_channel_id,
        notify: async (notice) =>
          this.replyDispatchService.notifyFailureForRetryJob(item, notice)
      });
      this.markTerminalFailureNotifiedById(item.message_id, item.message_channel_id);
      return;
    }

    const decision = this.failureClassifier.classify(error, {
      stage: "fetch_or_resolve",
      attemptCount: item.attempt_count
    });
    const notice = buildFailureNotice({
      category: decision.publicCategory,
      retryable: decision.retryable,
      ...(decision.delayMs == null ? {} : { delayMs: decision.delayMs })
    });

    try {
      await this.replyDispatchService.notifyFailureForRetryJob(item, notice);
    } catch (notifyError) {
      this.logger.warn(
        {
          error:
            notifyError instanceof Error ? notifyError.message : String(notifyError),
          messageId: item.message_id,
          channelId: item.reply_channel_id,
          threadId: item.reply_thread_id
        },
        "failed to notify retry-job failure in public target"
      );
    }

    if (decision.retryable) {
      this.retryScheduler.schedule({
        envelope: buildRetrySchedulerEnvelope({
          guildId: item.guild_id,
          messageChannelId: item.message_channel_id,
          messageId: item.message_id,
          replyThreadId: item.reply_thread_id
        }),
        watchLocation:
          retryWatchLocation ??
          resolveRetryWatchLocation(this.config, {
            guildId: item.guild_id,
            watchChannelId: item.watch_channel_id,
            mode: item.place_mode
          }),
        stage: "fetch_or_resolve",
        decision,
        replyChannelId: item.reply_channel_id,
        replyThreadId: item.reply_thread_id
      });
      return;
    }

    await this.replyDispatchService.notifyPermanentFailure({
      guildId: item.guild_id,
      messageId: item.message_id,
      placeMode: item.place_mode,
      channelId: item.message_channel_id,
      error,
      stage: "fetch_or_resolve",
      category: decision.publicCategory
    });
    this.markTerminalFailureNotifiedById(item.message_id, item.message_channel_id);
  }

  private resolveRetryJobWatchLocation(item: RetryJobRow): AppConfig["watchLocations"][number] | null {
    try {
      return resolveRetryWatchLocation(this.config, {
        guildId: item.guild_id,
        watchChannelId: item.watch_channel_id,
        mode: item.place_mode
      });
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: item.message_id,
          guildId: item.guild_id,
          watchChannelId: item.watch_channel_id,
          placeMode: item.place_mode
        },
        "failed to resolve retry job watch location from current config"
      );
      return null;
    }
  }

  private async handleForumTerminalFailure(input: {
    messageId: string;
    channelId: string;
    notify: (notice: string) => Promise<void>;
  }): Promise<void> {
    const notice =
      "調査回答の処理が中断しました。この依頼での visible retry は完了できなかったため、必要なら同じ thread で続けてください。";

    try {
      await input.notify(notice);
    } catch (notifyError) {
      this.logger.warn(
        {
          error:
            notifyError instanceof Error ? notifyError.message : String(notifyError),
          messageId: input.messageId,
          channelId: input.channelId
        },
        "failed to notify forum terminal failure in public target"
      );
    }
  }

  private startTypingIndicator(
    channel: GuildTextBasedChannel,
    context: {
      owner: "forum_high_thinking" | "message_processing";
      messageId: string;
      channelId: string;
    }
  ): TypingIndicatorController {
    let active = true;
    let timer: NodeJS.Timeout | null = null;

    appendRuntimeTrace("codex-app-server", "typing_indicator_started", context);

    const sendTyping = async (
      reason:
        | "startup"
        | "heartbeat"
        | "progress_notice"
        | "retry_status"
        | "retry_stream"
        | "final_stream"
    ): Promise<void> => {
      try {
        await channel.sendTyping();
        appendRuntimeTrace("codex-app-server", "typing_indicator_sent", {
          ...context,
          reason
        });
      } catch (error) {
        appendRuntimeTrace("codex-app-server", "typing_indicator_failed", {
          ...context,
          reason,
          error: error instanceof Error ? error.message : String(error)
        });
        this.logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            channelId: channel.id,
            owner: context.owner,
            messageId: context.messageId,
            reason
          },
          "failed to send typing indicator"
        );
      }
    };

    void sendTyping("startup");
    timer = setInterval(() => {
      if (!active) {
        return;
      }
      void sendTyping("heartbeat");
    }, 8_000);

    return {
      pulseNow: (reason) => {
        if (!active) {
          return Promise.resolve();
        }
        return sendTyping(reason);
      },
      stop: () => {
        active = false;
        if (timer) {
          clearInterval(timer);
        }
        appendRuntimeTrace("codex-app-server", "typing_indicator_stopped", context);
      }
    };
  }
}

function extractStageFailure(
  error: unknown,
  item: QueuedMessage,
  stage: StageFailureInput["stage"]
): StageFailureInput {
  return {
    stage,
    error,
    replyTarget: readReplyTarget(error) ?? buildSamePlaceReplyTarget(item)
  };
}

function readReplyTarget(
  error: unknown
): { channelId: string; threadId: string | null } | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as { replyTarget?: { channelId: string; threadId: string | null } };
  return candidate.replyTarget ?? null;
}

function createNoopTypingIndicator(): TypingIndicatorController {
  return {
    pulseNow: () => Promise.resolve(),
    stop: () => {}
  };
}

function toQueuedChatEngagement(
  evaluation: ChatEngagementEvaluation
): QueuedMessage["chatEngagement"] {
  return evaluation.triggerKind
    ? toChatEngagementFact({ evaluation })
    : null;
}

function routeQueuedMessageToWorkflow(
  item: QueuedMessage,
  workflow: ThreadWorkflow
): QueuedMessage {
  const watchLocation = buildWorkflowWatchLocation(item.watchLocation, workflow);
  return {
    ...item,
    watchLocation,
    scope: resolveScope(item.message, watchLocation),
    envelope: {
      ...item.envelope,
      placeType:
        workflow === "forum_research"
          ? "forum_post_thread"
          : item.envelope.placeType
    }
  };
}

function buildWorkflowWatchLocation(
  source: WatchLocationConfig,
  workflow: ThreadWorkflow
): WatchLocationConfig {
  if (workflow === "forum_research") {
    return {
      ...source,
      mode: "forum_longform",
      defaultScope: "conversation_only",
      features: ["forum_research", "conversation"],
      chatBehavior: null
    };
  }

  return {
    ...source,
    mode: "chat",
    defaultScope: "server_public",
    features: ["clear_explanation", "conversation"],
    chatBehavior: null
  };
}

function isLegacyForumRetryJobWithoutResolvedWatchLocation(
  item: RetryJobRow
): boolean {
  return item.place_mode === "forum_longform";
}
