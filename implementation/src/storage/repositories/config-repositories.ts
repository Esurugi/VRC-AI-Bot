import Database from "better-sqlite3";

import type {
  ChatBehavior,
  PlaceFeature,
  WatchLocationConfig
} from "../../domain/types.js";
import type { CodexSandboxMode } from "../../domain/types.js";
import type {
  SessionBindingKind,
  SessionLifecyclePolicy,
  SessionWorkloadKind
} from "../../codex/session-policy.js";
import type {
  ChannelCursorRow,
  CodexSessionBindingRow,
  WatchLocationRow
} from "../types.js";

type StoredWatchLocationRow = WatchLocationRow & {
  feature_profile_id: string | null;
  features_json: string | null;
  chat_behavior: ChatBehavior | null;
  chat_behavior_present: number;
};

export class WatchLocationRepository {
  constructor(private readonly db: Database.Database) {}

  sync(locations: WatchLocationConfig[]): void {
    const insert = this.db.prepare(`
      INSERT INTO watch_location (
        guild_id,
        channel_id,
        feature_profile_id,
        mode,
        default_scope,
        features_json,
        chat_behavior,
        chat_behavior_present
      )
      VALUES (
        @guild_id,
        @channel_id,
        @feature_profile_id,
        @mode,
        @default_scope,
        @features_json,
        @chat_behavior,
        @chat_behavior_present
      )
      ON CONFLICT(channel_id) DO UPDATE SET
        guild_id = excluded.guild_id,
        feature_profile_id = excluded.feature_profile_id,
        mode = excluded.mode,
        default_scope = excluded.default_scope,
        features_json = excluded.features_json,
        chat_behavior = excluded.chat_behavior,
        chat_behavior_present = excluded.chat_behavior_present,
        updated_at = CURRENT_TIMESTAMP
    `);
    const prune = this.db.prepare(
      `DELETE FROM watch_location WHERE channel_id NOT IN (${locations.map(() => "?").join(", ")})`
    );
    const clear = this.db.prepare("DELETE FROM watch_location");

    const transaction = this.db.transaction(() => {
      for (const location of locations) {
        insert.run({
          guild_id: location.guildId,
          channel_id: location.channelId,
          feature_profile_id: location.featureProfileId ?? null,
          mode: location.mode,
          default_scope: location.defaultScope,
          features_json:
            location.features === undefined ? null : JSON.stringify(location.features),
          chat_behavior: location.chatBehavior ?? null,
          chat_behavior_present: location.chatBehavior === undefined ? 0 : 1
        });
      }

      if (locations.length === 0) {
        clear.run();
      } else {
        prune.run(...locations.map((location) => location.channelId));
      }
    });

    transaction();
  }

  list(): WatchLocationConfig[] {
    return this.db
      .prepare(`
        SELECT
          guild_id,
          channel_id,
          feature_profile_id,
          mode,
          default_scope,
          features_json,
          chat_behavior,
          chat_behavior_present
        FROM watch_location
        ORDER BY channel_id
      `)
      .all()
      .map((row) => this.mapRow(row as StoredWatchLocationRow));
  }

  findForChannel(channelId: string): WatchLocationConfig | null {
    const row = this.db
      .prepare(`
        SELECT
          guild_id,
          channel_id,
          feature_profile_id,
          mode,
          default_scope,
          features_json,
          chat_behavior,
          chat_behavior_present
        FROM watch_location
        WHERE channel_id = ?
      `)
      .get(channelId) as StoredWatchLocationRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: StoredWatchLocationRow): WatchLocationConfig {
    const features = parseFeatures(row.features_json);
    return {
      guildId: row.guild_id,
      channelId: row.channel_id,
      ...(row.feature_profile_id === null
        ? {}
        : { featureProfileId: row.feature_profile_id }),
      mode: row.mode,
      defaultScope: row.default_scope,
      ...(features === undefined ? {} : { features }),
      ...(row.chat_behavior_present === 0
        ? {}
        : { chatBehavior: row.chat_behavior })
    };
  }
}

function parseFeatures(value: string | null): PlaceFeature[] | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("watch_location.features_json must contain a JSON array");
  }
  return parsed as PlaceFeature[];
}

export class ChannelCursorRepository {
  constructor(private readonly db: Database.Database) {}

  get(channelId: string): ChannelCursorRow | null {
    return (
      (this.db
        .prepare(
          "SELECT channel_id, last_processed_message_id, updated_at FROM channel_cursor WHERE channel_id = ?"
        )
        .get(channelId) as ChannelCursorRow | undefined) ?? null
    );
  }

  upsert(channelId: string, messageId: string): void {
    this.db
      .prepare(`
        INSERT INTO channel_cursor (channel_id, last_processed_message_id)
        VALUES (?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET
          last_processed_message_id = excluded.last_processed_message_id,
          updated_at = CURRENT_TIMESTAMP
        WHERE
          length(excluded.last_processed_message_id) > length(channel_cursor.last_processed_message_id)
          OR (
            length(excluded.last_processed_message_id) = length(channel_cursor.last_processed_message_id)
            AND excluded.last_processed_message_id > channel_cursor.last_processed_message_id
          )
      `)
      .run(channelId, messageId);
  }
}

export class CodexSessionBindingRepository {
  constructor(private readonly db: Database.Database) {}

  get(sessionIdentity: string): CodexSessionBindingRow | null {
    return (
      (this.db
        .prepare(
          `
            SELECT
              session_identity,
              workload_kind,
              binding_kind,
              binding_id,
              actor_id,
              sandbox_mode,
              model_profile,
              runtime_contract_version,
              lifecycle_policy,
              codex_thread_id,
              created_at,
              updated_at
            FROM codex_session_binding
            WHERE session_identity = ?
          `
        )
        .get(sessionIdentity) as CodexSessionBindingRow | undefined) ?? null
    );
  }

  upsert(input: {
    sessionIdentity: string;
    workloadKind: SessionWorkloadKind;
    bindingKind: SessionBindingKind;
    bindingId: string;
    actorId: string | null;
    sandboxMode: CodexSandboxMode;
    modelProfile: string;
    runtimeContractVersion: string;
    lifecyclePolicy: SessionLifecyclePolicy;
    codexThreadId: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO codex_session_binding (
          session_identity,
          workload_kind,
          binding_kind,
          binding_id,
          actor_id,
          sandbox_mode,
          model_profile,
          runtime_contract_version,
          lifecycle_policy,
          codex_thread_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_identity) DO UPDATE SET
          workload_kind = excluded.workload_kind,
          binding_kind = excluded.binding_kind,
          binding_id = excluded.binding_id,
          actor_id = excluded.actor_id,
          sandbox_mode = excluded.sandbox_mode,
          model_profile = excluded.model_profile,
          runtime_contract_version = excluded.runtime_contract_version,
          lifecycle_policy = excluded.lifecycle_policy,
          codex_thread_id = excluded.codex_thread_id,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.sessionIdentity,
        input.workloadKind,
        input.bindingKind,
        input.bindingId,
        input.actorId,
        input.sandboxMode,
        input.modelProfile,
        input.runtimeContractVersion,
        input.lifecyclePolicy,
        input.codexThreadId
      );
  }

  delete(sessionIdentity: string): void {
    this.db
      .prepare("DELETE FROM codex_session_binding WHERE session_identity = ?")
      .run(sessionIdentity);
  }
}
