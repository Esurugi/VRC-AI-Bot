import type { GuildTextBasedChannel } from "discord.js";
import type { Logger } from "pino";

import type { FailureClassifier } from "../../app/failure-classifier.js";
import type {
  BotModerationIntegration,
  PostResponseModerationInput
} from "../../app/moderation-integration.js";
import { buildFailureNotice } from "../../app/replies.js";
import type { RetrySchedulerService } from "../../app/retry-scheduler-service.js";
import type { ModerationExecutor } from "../../discord/moderation-executor.js";
import { writeDiscordRuntimeSnapshot } from "../../discord/runtime-facts.js";
import type { AppConfig } from "../../domain/types.js";
import { HarnessRunner } from "../../harness/harness-runner.js";
import { RecentChatHistoryService } from "../chat/recent-chat-history-service.js";
import {
  ForumFirstTurnPreprocessor,
  type ForumFirstTurnPreparation
} from "../forum/forum-first-turn-preprocessor.js";
import { SqliteStore, type RetryJobRow } from "../../storage/database.js";
import {
  buildRetrySchedulerEnvelope,
  buildSamePlaceReplyTarget,
  resolveRetryWatchLocation,
  type QueuedMessage,
  type RoutedHarnessMessage,
  type StageFailureInput
} from "../types.js";
import { ReplyDispatchService } from "./reply-dispatch-service.js";

export class MessageProcessingService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: SqliteStore,
    private readonly harnessRunner: HarnessRunner,
    private readonly forumFirstTurnPreprocessor: ForumFirstTurnPreprocessor,
    private readonly recentChatHistoryService: RecentChatHistoryService,
    private readonly failureClassifier: FailureClassifier,
    private readonly retryScheduler: RetrySchedulerService,
    private readonly moderationIntegration: BotModerationIntegration,
    private readonly moderationExecutor: ModerationExecutor,
    private readonly replyDispatchService: ReplyDispatchService,
    private readonly logger: Logger
  ) {}

  async process(item: QueuedMessage): Promise<void> {
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
      let forumBootstrap: ForumFirstTurnPreparation;
      try {
        forumBootstrap =
          await this.forumFirstTurnPreprocessor.resolveEffectiveContentOverride({
            message: item.message,
            envelope: item.envelope,
            watchLocation: item.watchLocation,
            actorRole: item.actorRole,
            scope: item.scope
          });
        routed = await this.resolveHarnessMessage(item, forumBootstrap);
      } catch (error) {
        await this.handleRuntimeFailure(item, {
          stage: "fetch_or_resolve",
          error,
          replyTarget: buildSamePlaceReplyTarget(item)
        });
        return;
      }

      try {
        replyTarget = await this.replyDispatchService.dispatchResolvedMessage(item, routed);
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

  async resolveHarnessMessage(
    item: QueuedMessage,
    forumBootstrap?: ForumFirstTurnPreparation
  ): Promise<RoutedHarnessMessage | null> {
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
    const recentMessages = await this.recentChatHistoryService.collect({
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
      recentMessages,
      forumStarterMessage: resolvedForumBootstrap.starterMessage,
      ...(item.watchLocation.mode === "forum_longform"
        ? { forumRetryCallbacks: this.buildForumCallbacks(item) }
        : {})
    });
  }

  private buildForumCallbacks(item: QueuedMessage) {
    let streamWriterPromise:
      | Promise<{
          append: (delta: string) => Promise<void>;
          complete: () => Promise<void>;
        }>
      | null = null;
    let statusSent = false;
    let progressSent = false;

    return {
      onProgressNotice: async (content: string) => {
        if (item.source !== "live" || progressSent) {
          return;
        }
        progressSent = true;
        await this.replyDispatchService.sendFollowupInSamePlace(item, content);
      },
      onRetryStatus: async (content: string) => {
        if (statusSent) {
          return;
        }
        statusSent = true;
        await this.replyDispatchService.sendFollowupInSamePlace(item, content);
      },
      onRetryStream: {
        onAgentMessageDelta: async (delta: string) => {
          streamWriterPromise ??=
            this.replyDispatchService.createStreamingReplyInSamePlace(item);
          const writer = await streamWriterPromise;
          await writer.append(delta);
        }
      },
      onRetryCompleted: async () => {
        if (!streamWriterPromise) {
          return;
        }
        const writer = await streamWriterPromise;
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
    const existingRetry = this.store.retryJobs.get(item.envelope.messageId);
    const decision = this.failureClassifier.classify(input.error, {
      stage: input.stage,
      attemptCount: existingRetry?.attempt_count ?? 0,
      watchMode: item.watchLocation.mode
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
    this.markMessageCompleted(item);
  }

  markMessageCompleted(item: QueuedMessage): void {
    this.markMessageCompletedById(item.envelope.messageId, item.envelope.channelId);
  }

  markMessageCompletedById(messageId: string, channelId: string): void {
    this.retryScheduler.clear(messageId);
    this.store.messageProcessing.markCompleted(messageId);
    this.store.channelCursors.upsert(channelId, messageId);
  }

  async handleRetryJobFailure(
    item: RetryJobRow,
    error: unknown
  ): Promise<void> {
    const decision = this.failureClassifier.classify(error, {
      stage: "fetch_or_resolve",
      attemptCount: item.attempt_count,
      watchMode: item.place_mode
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
        watchLocation: resolveRetryWatchLocation(this.config, {
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
    this.markMessageCompletedById(item.message_id, item.message_channel_id);
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
