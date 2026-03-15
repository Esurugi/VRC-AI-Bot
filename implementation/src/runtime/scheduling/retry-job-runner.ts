import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { RetrySchedulerService } from "../../app/retry-scheduler-service.js";
import { buildMessageEnvelope } from "../../discord/message-utils.js";
import { resolveActorRole, resolveScope } from "../../discord/facts.js";
import type { AppConfig } from "../../domain/types.js";
import { OrderedMessageQueue } from "../../queue/ordered-message-queue.js";
import { SqliteStore, type RetryJobRow } from "../../storage/database.js";
import { ReplyDispatchService } from "../message/reply-dispatch-service.js";
import { MessageProcessingService } from "../message/message-processing-service.js";
import type { QueuedMessage } from "../types.js";
import { resolveRetryWatchLocation } from "../types.js";

export class RetryJobRunner {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly client: Client,
    private readonly store: SqliteStore,
    private readonly retryScheduler: RetrySchedulerService,
    private readonly queue: OrderedMessageQueue<QueuedMessage>,
    private readonly replyDispatchService: ReplyDispatchService,
    private readonly messageProcessingService: MessageProcessingService,
    private readonly logger: Logger,
    private readonly intervalMs = 5_000
  ) {}

  start(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }

    void this.drainDueJobs().catch((error) => {
      this.logger.error({ error }, "failed to drain due retry jobs");
    });
    this.timer = setInterval(() => {
      void this.drainDueJobs().catch((error) => {
        this.logger.error({ error }, "failed to drain due retry jobs");
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async drainDueJobs(): Promise<void> {
    this.retryScheduler.clearByPlaceMode("forum_longform");
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
            channelId: job.message_channel_id
          },
          "retry job already enqueued"
        );
      }
    } catch (error) {
      await this.messageProcessingService.handleRetryJobFailure(job, error);
    }
  }

  private async fetchRetryQueuedMessage(job: RetryJobRow): Promise<QueuedMessage> {
    const channel = await this.replyDispatchService.fetchReplyChannel(job.message_channel_id);
    if (!channel) {
      throw new Error("channel no longer available");
    }

    const message = await channel.messages.fetch(job.message_id);
    if (!message.inGuild()) {
      throw new Error("message no longer available");
    }

    const typedMessage = message as typeof message & { guildId: string };
    const watchLocation = resolveRetryWatchLocation(this.config, {
      guildId: job.guild_id,
      watchChannelId: job.watch_channel_id,
      mode: job.place_mode
    });

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
}
