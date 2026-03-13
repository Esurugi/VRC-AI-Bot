import Database from "better-sqlite3";

import type { ActorRole } from "../../domain/types.js";
import type {
  SanctionStateRow,
  SoftBlockNoticeRow,
  ViolationEventRow
} from "../types.js";
import { buildInClause } from "./shared.js";

export class ViolationEventRepository {
  constructor(private readonly db: Database.Database) {}

  append(input: {
    eventId: string;
    guildId: string;
    userId: string;
    messageId: string;
    placeId: string;
    violationCategory: string;
    controlRequestClass: string | null;
    handledAs: string;
    countsTowardThreshold: boolean;
    actorRole: ActorRole;
    occurredAt: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO violation_event (
          event_id,
          guild_id,
          user_id,
          message_id,
          place_id,
          violation_category,
          control_request_class,
          handled_as,
          counts_toward_threshold,
          actor_role,
          occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.eventId,
        input.guildId,
        input.userId,
        input.messageId,
        input.placeId,
        input.violationCategory,
        input.controlRequestClass ?? "",
        input.handledAs,
        input.countsTowardThreshold ? 1 : 0,
        input.actorRole,
        input.occurredAt
      );
  }

  get(eventId: string): ViolationEventRow | null {
    return (
      (this.db
        .prepare(`
          SELECT
            event_id,
            guild_id,
            user_id,
            message_id,
            place_id,
            violation_category,
            control_request_class,
            handled_as,
            counts_toward_threshold,
            actor_role,
            occurred_at
          FROM violation_event
          WHERE event_id = ?
        `)
        .get(eventId) as ViolationEventRow | undefined) ?? null
    );
  }

  listForActorSince(input: {
    guildId: string;
    userId: string;
    occurredAtGte: string;
    countableOnly?: boolean;
  }): ViolationEventRow[] {
    const params: unknown[] = [input.guildId, input.userId, input.occurredAtGte];
    const countableClause = input.countableOnly ? "AND counts_toward_threshold = 1" : "";

    return this.db
      .prepare(`
        SELECT
          event_id,
          guild_id,
          user_id,
          message_id,
          place_id,
          violation_category,
          control_request_class,
          handled_as,
          counts_toward_threshold,
          actor_role,
          occurred_at
        FROM violation_event
        WHERE guild_id = ?
          AND user_id = ?
          AND occurred_at >= ?
          ${countableClause}
        ORDER BY occurred_at DESC, event_id DESC
      `)
      .all(...params) as ViolationEventRow[];
  }

  countForActorSince(input: {
    guildId: string;
    userId: string;
    occurredAtGte: string;
    countableOnly?: boolean;
  }): number {
    const params: unknown[] = [input.guildId, input.userId, input.occurredAtGte];
    const countableClause = input.countableOnly ? "AND counts_toward_threshold = 1" : "";

    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM violation_event
        WHERE guild_id = ?
          AND user_id = ?
          AND occurred_at >= ?
          ${countableClause}
      `)
      .get(...params) as { count: number };

    return row.count;
  }
}

export class SanctionStateRepository {
  constructor(private readonly db: Database.Database) {}

  insert(input: {
    sanctionId: string;
    guildId: string;
    userId: string;
    state: string;
    action: "timeout" | "soft_block" | "kick";
    deliveryStatus: "applied" | "fallback" | "failed";
    triggerEventId: string | null;
    startedAt: string;
    endsAt: string | null;
    reason: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO sanction_state (
          sanction_id,
          guild_id,
          user_id,
          state,
          action,
          delivery_status,
          trigger_event_id,
          started_at,
          ends_at,
          reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.sanctionId,
        input.guildId,
        input.userId,
        input.state,
        input.action,
        input.deliveryStatus,
        input.triggerEventId,
        input.startedAt,
        input.endsAt,
        input.reason
      );
  }

  getActiveSoftBlock(guildId: string, userId: string, nowIso: string): SanctionStateRow | null {
    return (
      (this.db
        .prepare(`
          SELECT
            sanction_id,
            guild_id,
            user_id,
            state,
            action,
            delivery_status,
            trigger_event_id,
            started_at,
            ends_at,
            reason
          FROM sanction_state
          WHERE guild_id = ?
            AND user_id = ?
            AND action = 'soft_block'
            AND state = 'active'
            AND (ends_at IS NULL OR ends_at > ?)
          ORDER BY started_at DESC, sanction_id DESC
          LIMIT 1
        `)
        .get(guildId, userId, nowIso) as SanctionStateRow | undefined) ?? null
    );
  }

  listRecentForActor(input: {
    guildId: string;
    userId: string;
    startedAtGte: string;
    actions?: Array<"timeout" | "soft_block" | "kick">;
    states?: string[];
  }): SanctionStateRow[] {
    const params: unknown[] = [input.guildId, input.userId, input.startedAtGte];
    const actionClause =
      input.actions && input.actions.length > 0
        ? `AND action IN (${buildInClause(input.actions.length)})`
        : "";
    const stateClause =
      input.states && input.states.length > 0
        ? `AND state IN (${buildInClause(input.states.length)})`
        : "";

    if (input.actions) {
      params.push(...input.actions);
    }
    if (input.states) {
      params.push(...input.states);
    }

    return this.db
      .prepare(`
        SELECT
          sanction_id,
          guild_id,
          user_id,
          state,
          action,
          delivery_status,
          trigger_event_id,
          started_at,
          ends_at,
          reason
        FROM sanction_state
        WHERE guild_id = ?
          AND user_id = ?
          AND started_at >= ?
          ${actionClause}
          ${stateClause}
        ORDER BY started_at DESC, sanction_id DESC
      `)
      .all(...params) as SanctionStateRow[];
  }
}

export class SoftBlockNoticeRepository {
  constructor(private readonly db: Database.Database) {}

  get(guildId: string, userId: string, channelId: string): SoftBlockNoticeRow | null {
    return (
      (this.db
        .prepare(`
          SELECT
            guild_id,
            user_id,
            channel_id,
            last_notified_at
          FROM soft_block_notice
          WHERE guild_id = ? AND user_id = ? AND channel_id = ?
        `)
        .get(guildId, userId, channelId) as SoftBlockNoticeRow | undefined) ?? null
    );
  }

  upsert(input: {
    guildId: string;
    userId: string;
    channelId: string;
    lastNotifiedAt: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO soft_block_notice (
          guild_id,
          user_id,
          channel_id,
          last_notified_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id, channel_id) DO UPDATE SET
          last_notified_at = excluded.last_notified_at
      `)
      .run(input.guildId, input.userId, input.channelId, input.lastNotifiedAt);
  }
}
