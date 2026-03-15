import type { Logger } from "pino";

import type { FailureDecision, FailureStage } from "./failure-classifier.js";
import type { MessageEnvelope, WatchLocationConfig } from "../domain/types.js";
import type { SqliteStore } from "../storage/database.js";

export class RetrySchedulerService {
  constructor(
    private readonly store: SqliteStore,
    private readonly logger?: Pick<Logger, "debug">
  ) {}

  schedule(input: {
    envelope: MessageEnvelope;
    watchLocation: WatchLocationConfig;
    stage: FailureStage;
    decision: FailureDecision;
    replyChannelId: string;
    replyThreadId: string | null;
    now?: Date;
  }): void {
    if (!input.decision.retryable || input.decision.delayMs == null) {
      throw new Error("retry schedule requested for non-retryable decision");
    }

    const now = input.now ?? new Date();
    const existing = this.store.retryJobs.get(input.envelope.messageId);
    const attemptCount = (existing?.attempt_count ?? 0) + 1;
    const nextAttemptAt = new Date(now.getTime() + input.decision.delayMs).toISOString();

    this.store.retryJobs.upsert({
      messageId: input.envelope.messageId,
      guildId: input.envelope.guildId,
      messageChannelId: input.envelope.channelId,
      watchChannelId: input.watchLocation.channelId,
      attemptCount,
      nextAttemptAt,
      lastFailureCategory: input.decision.publicCategory,
      replyChannelId: input.replyChannelId,
      replyThreadId: input.replyThreadId,
      placeMode: input.watchLocation.mode,
      stage: input.stage
    });
    this.store.messageProcessing.markPendingRetry(input.envelope.messageId);
    this.logger?.debug?.(
      {
        messageId: input.envelope.messageId,
        attemptCount,
        nextAttemptAt,
        stage: input.stage,
        category: input.decision.publicCategory
      },
      "scheduled retry job"
    );
  }

  pollDueJobs(now = new Date()) {
    return this.store.retryJobs.listDue(now.toISOString());
  }

  clear(messageId: string): void {
    this.store.retryJobs.delete(messageId);
  }

  clearByPlaceMode(mode: WatchLocationConfig["mode"]): void {
    this.store.retryJobs.deleteByPlaceMode(mode);
  }
}
