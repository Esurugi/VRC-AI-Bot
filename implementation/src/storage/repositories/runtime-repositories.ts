import Database from "better-sqlite3";

import type { WatchLocationConfig } from "../../domain/types.js";
import type {
  AppRuntimeLockRow,
  ChatChannelCounterRow,
  MessageProcessingRow,
  RetryJobRow,
  ScheduledDeliveryRow
} from "../types.js";
import { isProcessAlive } from "./shared.js";

export class ChatChannelCounterRepository {
  constructor(private readonly db: Database.Database) {}

  get(channelId: string): ChatChannelCounterRow | null {
    return (
      (this.db
        .prepare(`
          SELECT channel_id, ordinary_message_count, updated_at
          FROM chat_channel_counter
          WHERE channel_id = ?
        `)
        .get(channelId) as ChatChannelCounterRow | undefined) ?? null
    );
  }

  increment(channelId: string): ChatChannelCounterRow {
    this.db
      .prepare(`
        INSERT INTO chat_channel_counter (channel_id, ordinary_message_count)
        VALUES (?, 1)
        ON CONFLICT(channel_id) DO UPDATE SET
          ordinary_message_count = ordinary_message_count + 1,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(channelId);

    const row = this.get(channelId);
    if (!row) {
      throw new Error("chat channel counter increment failed");
    }
    return row;
  }

  reset(channelId: string): void {
    this.db
      .prepare(`
        INSERT INTO chat_channel_counter (channel_id, ordinary_message_count)
        VALUES (?, 0)
        ON CONFLICT(channel_id) DO UPDATE SET
          ordinary_message_count = 0,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(channelId);
  }

  resetAll(): void {
    this.db
      .prepare(`
        UPDATE chat_channel_counter
        SET
          ordinary_message_count = 0,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run();
  }
}

export class ScheduledDeliveryRepository {
  constructor(private readonly db: Database.Database) {}

  get(eventKey: string, occurrenceDate: string): ScheduledDeliveryRow | null {
    return (
      (this.db
        .prepare(`
          SELECT event_key, occurrence_date, delivered_at, channel_id, message_id
          FROM scheduled_delivery
          WHERE event_key = ? AND occurrence_date = ?
        `)
        .get(eventKey, occurrenceDate) as ScheduledDeliveryRow | undefined) ?? null
    );
  }

  markDelivered(input: {
    eventKey: string;
    occurrenceDate: string;
    deliveredAt: string;
    channelId: string;
    messageId: string | null;
  }): void {
    this.db
      .prepare(`
        INSERT INTO scheduled_delivery (
          event_key,
          occurrence_date,
          delivered_at,
          channel_id,
          message_id
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(event_key, occurrence_date) DO UPDATE SET
          delivered_at = excluded.delivered_at,
          channel_id = excluded.channel_id,
          message_id = excluded.message_id
      `)
      .run(
        input.eventKey,
        input.occurrenceDate,
        input.deliveredAt,
        input.channelId,
        input.messageId
      );
  }
}

export class MessageProcessingRepository {
  constructor(private readonly db: Database.Database) {}

  tryAcquire(
    messageId: string,
    channelId: string,
    input: {
      leaseMs?: number;
      allowPendingRetryAcquire?: boolean;
    } = {}
  ): {
    status: "acquired" | "already_completed" | "in_flight" | "pending_retry";
  } {
    const now = new Date();
    const leaseMs = input.leaseMs ?? 5 * 60_000;
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const nowIso = now.toISOString();

    const find = this.db.prepare(`
      SELECT
        message_id,
        channel_id,
        state,
        lease_expires_at,
        created_at,
        updated_at,
        completed_at
      FROM message_processing
      WHERE message_id = ?
    `);
    const insert = this.db.prepare(`
      INSERT INTO message_processing (
        message_id,
        channel_id,
        state,
        lease_expires_at,
        created_at,
        updated_at,
        completed_at
      ) VALUES (?, ?, 'processing', ?, ?, ?, NULL)
    `);
    const updateLease = this.db.prepare(`
      UPDATE message_processing
      SET
        channel_id = ?,
        state = 'processing',
        lease_expires_at = ?,
        updated_at = ?,
        completed_at = NULL
      WHERE message_id = ?
    `);

    const transaction = this.db.transaction((): {
      status: "acquired" | "already_completed" | "in_flight" | "pending_retry";
    } => {
      const existing = find.get(messageId) as MessageProcessingRow | undefined;
      if (!existing) {
        insert.run(messageId, channelId, leaseExpiresAt, nowIso, nowIso);
        return { status: "acquired" } as const;
      }

      if (existing.state === "completed") {
        return { status: "already_completed" } as const;
      }

      if (existing.state === "pending_retry") {
        if (!input.allowPendingRetryAcquire) {
          return { status: "pending_retry" } as const;
        }

        updateLease.run(channelId, leaseExpiresAt, nowIso, messageId);
        return { status: "acquired" } as const;
      }

      if (!existing.lease_expires_at || existing.lease_expires_at > nowIso) {
        return { status: "in_flight" } as const;
      }

      updateLease.run(channelId, leaseExpiresAt, nowIso, messageId);
      return { status: "acquired" } as const;
    });

    return transaction();
  }

  markPendingRetry(messageId: string): void {
    this.db
      .prepare(`
        UPDATE message_processing
        SET
          state = 'pending_retry',
          lease_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP,
          completed_at = NULL
        WHERE message_id = ?
      `)
      .run(messageId);
  }

  markCompleted(messageId: string): void {
    this.db
      .prepare(`
        UPDATE message_processing
        SET
          state = 'completed',
          lease_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP,
          completed_at = CURRENT_TIMESTAMP
        WHERE message_id = ?
      `)
      .run(messageId);
  }

  get(messageId: string): MessageProcessingRow | null {
    return (
      (this.db
        .prepare(`
          SELECT
            message_id,
            channel_id,
            state,
            lease_expires_at,
            created_at,
            updated_at,
            completed_at
          FROM message_processing
          WHERE message_id = ?
        `)
        .get(messageId) as MessageProcessingRow | undefined) ?? null
    );
  }
}

export class RetryJobRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(input: {
    messageId: string;
    guildId: string;
    messageChannelId: string;
    watchChannelId: string;
    attemptCount: number;
    nextAttemptAt: string;
    lastFailureCategory: string;
    replyChannelId: string;
    replyThreadId: string | null;
    placeMode: WatchLocationConfig["mode"];
    stage: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO retry_job (
          message_id,
          guild_id,
          message_channel_id,
          watch_channel_id,
          attempt_count,
          next_attempt_at,
          last_failure_category,
          reply_channel_id,
          reply_thread_id,
          place_mode,
          stage
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET
          guild_id = excluded.guild_id,
          message_channel_id = excluded.message_channel_id,
          watch_channel_id = excluded.watch_channel_id,
          attempt_count = excluded.attempt_count,
          next_attempt_at = excluded.next_attempt_at,
          last_failure_category = excluded.last_failure_category,
          reply_channel_id = excluded.reply_channel_id,
          reply_thread_id = excluded.reply_thread_id,
          place_mode = excluded.place_mode,
          stage = excluded.stage,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.messageId,
        input.guildId,
        input.messageChannelId,
        input.watchChannelId,
        input.attemptCount,
        input.nextAttemptAt,
        input.lastFailureCategory,
        input.replyChannelId,
        input.replyThreadId,
        input.placeMode,
        input.stage
      );
  }

  get(messageId: string): RetryJobRow | null {
    return (
      (this.db
        .prepare(`
          SELECT
            message_id,
            guild_id,
            message_channel_id,
            watch_channel_id,
            attempt_count,
            next_attempt_at,
            last_failure_category,
            reply_channel_id,
            reply_thread_id,
            place_mode,
            stage,
            created_at,
            updated_at
          FROM retry_job
          WHERE message_id = ?
        `)
        .get(messageId) as RetryJobRow | undefined) ?? null
    );
  }

  listDue(nowIso: string, limit = 50): RetryJobRow[] {
    return this.db
      .prepare(`
        SELECT
          message_id,
          guild_id,
          message_channel_id,
          watch_channel_id,
          attempt_count,
          next_attempt_at,
          last_failure_category,
          reply_channel_id,
          reply_thread_id,
          place_mode,
          stage,
          created_at,
          updated_at
        FROM retry_job
        WHERE next_attempt_at <= ?
        ORDER BY next_attempt_at ASC, message_id ASC
        LIMIT ?
      `)
      .all(nowIso, limit) as RetryJobRow[];
  }

  delete(messageId: string): void {
    this.db
      .prepare(`
        DELETE FROM retry_job
        WHERE message_id = ?
      `)
      .run(messageId);
  }
}

export class AppRuntimeLockRepository {
  private static readonly lockName = "bot";

  constructor(private readonly db: Database.Database) {}

  tryAcquire(instanceId: string, ownerPid: number, leaseMs = 30_000): boolean {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();

    const find = this.db.prepare(`
      SELECT
        lock_name,
        instance_id,
        owner_pid,
        lease_expires_at,
        created_at,
        updated_at
      FROM app_runtime_lock
      WHERE lock_name = ?
    `);
    const insert = this.db.prepare(`
      INSERT INTO app_runtime_lock (
        lock_name,
        instance_id,
        owner_pid,
        lease_expires_at
      ) VALUES (?, ?, ?, ?)
    `);
    const update = this.db.prepare(`
      UPDATE app_runtime_lock
      SET
        instance_id = ?,
        owner_pid = ?,
        lease_expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE lock_name = ?
    `);

    const transaction = this.db.transaction(() => {
      const existing = find.get(AppRuntimeLockRepository.lockName) as
        | AppRuntimeLockRow
        | undefined;
      if (!existing) {
        insert.run(AppRuntimeLockRepository.lockName, instanceId, ownerPid, leaseExpiresAt);
        return true;
      }

      if (
        existing.instance_id !== instanceId &&
        existing.owner_pid !== ownerPid &&
        existing.lease_expires_at > nowIso &&
        isProcessAlive(existing.owner_pid)
      ) {
        return false;
      }

      update.run(instanceId, ownerPid, leaseExpiresAt, AppRuntimeLockRepository.lockName);
      return true;
    });

    return transaction();
  }

  renew(instanceId: string, ownerPid: number, leaseMs = 30_000): boolean {
    const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    const result = this.db
      .prepare(`
        UPDATE app_runtime_lock
        SET
          lease_expires_at = ?,
          owner_pid = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE lock_name = ? AND instance_id = ?
      `)
      .run(leaseExpiresAt, ownerPid, AppRuntimeLockRepository.lockName, instanceId);

    return result.changes > 0;
  }

  release(instanceId: string): void {
    this.db
      .prepare("DELETE FROM app_runtime_lock WHERE lock_name = ? AND instance_id = ?")
      .run(AppRuntimeLockRepository.lockName, instanceId);
  }

  get(): AppRuntimeLockRow | null {
    return (
      (this.db
        .prepare(`
          SELECT
            lock_name,
            instance_id,
            owner_pid,
            lease_expires_at,
            created_at,
            updated_at
          FROM app_runtime_lock
          WHERE lock_name = ?
        `)
        .get(AppRuntimeLockRepository.lockName) as AppRuntimeLockRow | undefined) ?? null
    );
  }
}
