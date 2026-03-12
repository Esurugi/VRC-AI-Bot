import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

import type {
  CodexSandboxMode,
  Scope,
  VisibleCandidate,
  WatchLocationConfig
} from "../domain/types.js";
import type {
  SessionBindingKind,
  SessionLifecyclePolicy,
  SessionWorkloadKind
} from "../codex/session-policy.js";
import type {
  OverrideFlags,
  OverrideSessionRecord
} from "../override/types.js";

type WatchLocationRow = {
  guild_id: string;
  channel_id: string;
  mode: WatchLocationConfig["mode"];
  default_scope: WatchLocationConfig["defaultScope"];
};

type ChannelCursorRow = {
  channel_id: string;
  last_processed_message_id: string;
  updated_at: string;
};

export type CodexSessionBindingRow = {
  session_identity: string;
  workload_kind: SessionWorkloadKind;
  binding_kind: SessionBindingKind;
  binding_id: string;
  actor_id: string | null;
  sandbox_mode: CodexSandboxMode;
  model_profile: string;
  runtime_contract_version: string;
  lifecycle_policy: SessionLifecyclePolicy;
  codex_thread_id: string;
  created_at: string;
  updated_at: string;
};

export type KnowledgeRecordRow = {
  record_id: string;
  canonical_url: string;
  domain: string;
  title: string;
  summary: string;
  tags_json: string;
  scope: WatchLocationConfig["defaultScope"];
  visibility_key: string;
  content_hash: string;
  created_at: string;
};

export type KnowledgeArtifactRow = {
  record_id: string;
  final_url: string;
  snapshot_path: string;
  screenshot_path: string | null;
  network_log_path: string | null;
};

export type KnowledgeSourceTextRow = {
  record_id: string;
  normalized_text: string;
  source_kind: string;
  captured_at: string;
};

type SourceLinkRow = {
  link_id: string;
  record_id: string;
  source_message_id: string;
  reply_thread_id: string | null;
  created_at: string;
};

type ThreadKnowledgeContextRow = {
  source_message_id: string;
  record_id: string;
  canonical_url: string;
  title: string;
  summary: string;
  tags_json: string;
  scope: WatchLocationConfig["defaultScope"];
  created_at: string;
};

type MessageProcessingRow = {
  message_id: string;
  channel_id: string;
  state: "processing" | "completed";
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type AppRuntimeLockRow = {
  lock_name: string;
  instance_id: string;
  owner_pid: number;
  lease_expires_at: string;
  created_at: string;
  updated_at: string;
};

type OverrideSessionRow = {
  session_id: string;
  guild_id: string;
  actor_id: string;
  granted_by: string;
  scope_place_id: string;
  flags_json: string;
  sandbox_mode: "workspace-write";
  started_at: string;
  ended_at: string | null;
  ended_by: string | null;
  cleanup_reason: string | null;
};

export class SqliteStore {
  readonly db: Database.Database;
  readonly watchLocations: WatchLocationRepository;
  readonly channelCursors: ChannelCursorRepository;
  readonly codexSessions: CodexSessionBindingRepository;
  readonly knowledgeRecords: KnowledgeRecordRepository;
  readonly knowledgeArtifacts: KnowledgeArtifactRepository;
  readonly knowledgeSourceTexts: KnowledgeSourceTextRepository;
  readonly sourceLinks: SourceLinkRepository;
  readonly overrideSessions: OverrideSessionRepository;
  readonly messageProcessing: MessageProcessingRepository;
  readonly runtimeLock: AppRuntimeLockRepository;

  constructor(dbPath: string, private readonly projectRoot = process.cwd()) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.watchLocations = new WatchLocationRepository(this.db);
    this.channelCursors = new ChannelCursorRepository(this.db);
    this.codexSessions = new CodexSessionBindingRepository(this.db);
    this.knowledgeRecords = new KnowledgeRecordRepository(this.db);
    this.knowledgeArtifacts = new KnowledgeArtifactRepository(this.db);
    this.knowledgeSourceTexts = new KnowledgeSourceTextRepository(this.db);
    this.sourceLinks = new SourceLinkRepository(this.db);
    this.overrideSessions = new OverrideSessionRepository(this.db);
    this.messageProcessing = new MessageProcessingRepository(this.db);
    this.runtimeLock = new AppRuntimeLockRepository(this.db);
  }

  migrate(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    );
    const migrationDir = resolve(this.projectRoot, "migrations");
    const files = readdirSync(migrationDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const hasMigration = this.db.prepare(
      "SELECT 1 FROM schema_migrations WHERE name = ?"
    );
    const recordMigration = this.db.prepare(
      "INSERT INTO schema_migrations (name) VALUES (?)"
    );

    for (const file of files) {
      const exists = hasMigration.get(file);
      if (exists) {
        continue;
      }

      const sql = readFileSync(resolve(migrationDir, file), "utf8");
      const transaction = this.db.transaction(() => {
        this.db.exec(sql);
        recordMigration.run(file);
      });
      transaction();
    }
  }

  close(): void {
    this.db.close();
  }
}

export class WatchLocationRepository {
  constructor(private readonly db: Database.Database) {}

  sync(locations: WatchLocationConfig[]): void {
    const insert = this.db.prepare(`
      INSERT INTO watch_location (guild_id, channel_id, mode, default_scope)
      VALUES (@guild_id, @channel_id, @mode, @default_scope)
      ON CONFLICT(channel_id) DO UPDATE SET
        guild_id = excluded.guild_id,
        mode = excluded.mode,
        default_scope = excluded.default_scope,
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
          mode: location.mode,
          default_scope: location.defaultScope
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
      .prepare("SELECT guild_id, channel_id, mode, default_scope FROM watch_location ORDER BY channel_id")
      .all()
      .map((row) => this.mapRow(row as WatchLocationRow));
  }

  findForChannel(channelId: string): WatchLocationConfig | null {
    const row = this.db
      .prepare("SELECT guild_id, channel_id, mode, default_scope FROM watch_location WHERE channel_id = ?")
      .get(channelId) as WatchLocationRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: WatchLocationRow): WatchLocationConfig {
    return {
      guildId: row.guild_id,
      channelId: row.channel_id,
      mode: row.mode,
      defaultScope: row.default_scope
    };
  }
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

export class KnowledgeRecordRepository {
  constructor(private readonly db: Database.Database) {}

  findByDedup(
    canonicalUrl: string,
    contentHash: string,
    scope: WatchLocationConfig["defaultScope"],
    visibilityKey: string
  ): KnowledgeRecordRow | null {
    return (
      (this.db
        .prepare(
          `
            SELECT
              record_id,
              canonical_url,
              domain,
              title,
              summary,
              tags_json,
              scope,
              visibility_key,
              content_hash,
              created_at
            FROM knowledge_record
            WHERE canonical_url = ? AND content_hash = ? AND scope = ? AND visibility_key = ?
          `
        )
        .get(
          canonicalUrl,
          contentHash,
          scope,
          visibilityKey
        ) as KnowledgeRecordRow | undefined) ??
      null
    );
  }

  insert(input: {
    recordId: string;
    canonicalUrl: string;
    domain: string;
    title: string;
    summary: string;
    tags: string[];
    scope: WatchLocationConfig["defaultScope"];
    visibilityKey: string;
    contentHash: string;
    createdAt: string;
  }): void {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO knowledge_record (
            record_id,
            canonical_url,
            domain,
            title,
            summary,
            tags_json,
            scope,
            visibility_key,
            content_hash,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          input.recordId,
          input.canonicalUrl,
          input.domain,
          input.title,
          input.summary,
          JSON.stringify(input.tags),
          input.scope,
          input.visibilityKey,
          input.contentHash,
          input.createdAt
        );

      this.db
        .prepare(`
          INSERT INTO knowledge_record_fts (
            record_id,
            canonical_url,
            domain,
            title,
            summary,
            tags
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          input.recordId,
          input.canonicalUrl,
          input.domain,
          input.title,
          input.summary,
          input.tags.join(" ")
        );
    });

    transaction();
  }

  get(recordId: string): KnowledgeRecordRow | null {
    return (
      (this.db
        .prepare(`
          SELECT
            record_id,
            canonical_url,
            domain,
            title,
            summary,
            tags_json,
            scope,
            visibility_key,
            content_hash,
            created_at
          FROM knowledge_record
          WHERE record_id = ?
        `)
        .get(recordId) as KnowledgeRecordRow | undefined) ?? null
    );
  }

  findVisibleByCanonicalUrl(
    canonicalUrl: string,
    allowedScopes: Scope[],
    allowedVisibilityKeys: string[]
  ): VisibleCandidate[] {
    if (allowedScopes.length === 0 || allowedVisibilityKeys.length === 0) {
      return [];
    }

    return this.db
      .prepare(`
        SELECT
          record_id,
          canonical_url,
          title,
          summary,
          tags_json,
          scope,
          created_at
        FROM knowledge_record
        WHERE canonical_url = ?
          AND scope IN (${buildInClause(allowedScopes.length)})
          AND visibility_key IN (${buildInClause(allowedVisibilityKeys.length)})
        ORDER BY created_at DESC
      `)
      .all(
        canonicalUrl,
        ...allowedScopes,
        ...allowedVisibilityKeys
      )
      .map((row) => mapVisibleCandidate(row as ThreadKnowledgeContextRow));
  }

  searchVisibleByTerms(input: {
    matchQuery: string;
    allowedScopes: Scope[];
    allowedVisibilityKeys: string[];
    limit: number;
  }): VisibleCandidate[] {
    if (input.allowedScopes.length === 0 || input.allowedVisibilityKeys.length === 0) {
      return [];
    }

    return this.db
      .prepare(`
        SELECT
          kr.record_id,
          kr.canonical_url,
          kr.title,
          kr.summary,
          kr.tags_json,
          kr.scope,
          kr.created_at
        FROM knowledge_record_fts
        INNER JOIN knowledge_record kr
          ON kr.record_id = knowledge_record_fts.record_id
        WHERE knowledge_record_fts MATCH ?
          AND kr.scope IN (${buildInClause(input.allowedScopes.length)})
          AND kr.visibility_key IN (${buildInClause(input.allowedVisibilityKeys.length)})
        ORDER BY bm25(knowledge_record_fts), kr.created_at DESC
        LIMIT ?
      `)
      .all(
        input.matchQuery,
        ...input.allowedScopes,
        ...input.allowedVisibilityKeys,
        input.limit
      )
      .map((row) => mapVisibleCandidate(row as ThreadKnowledgeContextRow));
  }
}

export class KnowledgeArtifactRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(input: {
    recordId: string;
    finalUrl: string;
    snapshotPath: string;
    screenshotPath: string | null;
    networkLogPath: string | null;
  }): void {
    this.db
      .prepare(`
        INSERT INTO knowledge_artifact (
          record_id,
          final_url,
          snapshot_path,
          screenshot_path,
          network_log_path
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(record_id) DO UPDATE SET
          final_url = excluded.final_url,
          snapshot_path = excluded.snapshot_path,
          screenshot_path = excluded.screenshot_path,
          network_log_path = excluded.network_log_path
      `)
      .run(
        input.recordId,
        input.finalUrl,
        input.snapshotPath,
        input.screenshotPath,
        input.networkLogPath
      );
  }

  get(recordId: string): KnowledgeArtifactRow | null {
    return (
      (this.db
        .prepare(`
          SELECT
            record_id,
            final_url,
            snapshot_path,
            screenshot_path,
            network_log_path
          FROM knowledge_artifact
          WHERE record_id = ?
        `)
        .get(recordId) as KnowledgeArtifactRow | undefined) ?? null
    );
  }
}

export class KnowledgeSourceTextRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(input: {
    recordId: string;
    normalizedText: string;
    sourceKind: string;
    capturedAt: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO knowledge_source_text (
          record_id,
          normalized_text,
          source_kind,
          captured_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(record_id) DO UPDATE SET
          normalized_text = excluded.normalized_text,
          source_kind = excluded.source_kind,
          captured_at = excluded.captured_at
      `)
      .run(
        input.recordId,
        input.normalizedText,
        input.sourceKind,
        input.capturedAt
      );
  }

  get(recordId: string): KnowledgeSourceTextRow | null {
    return (
      (this.db
        .prepare(`
          SELECT
            record_id,
            normalized_text,
            source_kind,
            captured_at
          FROM knowledge_source_text
          WHERE record_id = ?
        `)
        .get(recordId) as KnowledgeSourceTextRow | undefined) ?? null
    );
  }
}

export class SourceLinkRepository {
  constructor(private readonly db: Database.Database) {}

  insert(input: {
    linkId: string;
    recordId: string;
    sourceMessageId: string;
    replyThreadId: string | null;
    createdAt: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO source_link (
          link_id,
          record_id,
          source_message_id,
          reply_thread_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        input.linkId,
        input.recordId,
        input.sourceMessageId,
        input.replyThreadId,
        input.createdAt
      );
  }

  listForSourceMessage(sourceMessageId: string): SourceLinkRow[] {
    return this.db
      .prepare(`
        SELECT
          link_id,
          record_id,
          source_message_id,
          reply_thread_id,
          created_at
        FROM source_link
        WHERE source_message_id = ?
        ORDER BY created_at
      `)
      .all(sourceMessageId) as SourceLinkRow[];
  }

  listKnowledgeContextForReplyThread(replyThreadId: string): Array<
    VisibleCandidate & {
      sourceMessageId: string;
    }
  > {
    const rows = this.db
      .prepare(`
        SELECT
          sl.source_message_id,
          kr.record_id,
          kr.canonical_url,
          kr.title,
          kr.summary,
          kr.tags_json,
          kr.scope,
          kr.created_at
        FROM source_link sl
        INNER JOIN knowledge_record kr
          ON kr.record_id = sl.record_id
        WHERE sl.reply_thread_id = ?
        ORDER BY sl.created_at, kr.created_at
      `)
      .all(replyThreadId) as ThreadKnowledgeContextRow[];

    const seen = new Set<string>();
    const context: Array<
      VisibleCandidate & {
        sourceMessageId: string;
      }
    > = [];

    for (const row of rows) {
      if (seen.has(row.record_id)) {
        continue;
      }
      seen.add(row.record_id);
      context.push({
        sourceMessageId: row.source_message_id,
        ...mapVisibleCandidate(row)
      });
    }

    return context;
  }
}

function buildInClause(size: number): string {
  return Array.from({ length: size }, () => "?").join(", ");
}

function mapVisibleCandidate(row: ThreadKnowledgeContextRow): VisibleCandidate {
  return {
    sourceId: row.record_id,
    title: row.title,
    summary: row.summary,
    tags: JSON.parse(row.tags_json) as string[],
    scope: row.scope,
    recency: row.created_at,
    canonicalUrl: row.canonical_url
  };
}

export class OverrideSessionRepository {
  constructor(private readonly db: Database.Database) {}

  getActive(
    guildId: string,
    scopePlaceId: string,
    actorId: string
  ): OverrideSessionRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT
            session_id,
            guild_id,
            actor_id,
            granted_by,
            scope_place_id,
            flags_json,
            sandbox_mode,
            started_at,
            ended_at,
            ended_by,
            cleanup_reason
          FROM override_session
          WHERE guild_id = ? AND scope_place_id = ? AND actor_id = ? AND ended_at IS NULL
          ORDER BY started_at DESC
          LIMIT 1
        `
      )
      .get(guildId, scopePlaceId, actorId) as OverrideSessionRow | undefined;

    return row ? mapOverrideSessionRow(row) : null;
  }

  start(input: {
    sessionId: string;
    guildId: string;
    actorId: string;
    grantedBy: string;
    scopePlaceId: string;
    flags: OverrideFlags;
    sandboxMode: "workspace-write";
    startedAt: string;
  }): OverrideSessionRecord {
    const closeExisting = this.db.prepare(
      `
        UPDATE override_session
        SET
          ended_at = ?,
          ended_by = ?,
          cleanup_reason = 'replaced'
        WHERE guild_id = ? AND scope_place_id = ? AND actor_id = ? AND ended_at IS NULL
      `
    );
    const insert = this.db.prepare(
      `
        INSERT INTO override_session (
          session_id,
          guild_id,
          actor_id,
          granted_by,
          scope_place_id,
          flags_json,
          sandbox_mode,
          started_at,
          ended_at,
          ended_by,
          cleanup_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      `
    );

    const transaction = this.db.transaction(() => {
      closeExisting.run(
        input.startedAt,
        input.grantedBy,
        input.guildId,
        input.scopePlaceId,
        input.actorId
      );
      insert.run(
        input.sessionId,
        input.guildId,
        input.actorId,
        input.grantedBy,
        input.scopePlaceId,
        JSON.stringify(input.flags),
        input.sandboxMode,
        input.startedAt
      );
    });

    transaction();
    const created = this.getActive(input.guildId, input.scopePlaceId, input.actorId);
    if (!created) {
      throw new Error("override session insert failed");
    }
    return created;
  }

  endActive(input: {
    guildId: string;
    scopePlaceId: string;
    actorId: string;
    endedAt: string;
    endedBy: string;
    cleanupReason: string | null;
  }): boolean {
    const result = this.db
      .prepare(
        `
          UPDATE override_session
          SET
            ended_at = ?,
            ended_by = ?,
            cleanup_reason = ?
          WHERE guild_id = ? AND scope_place_id = ? AND actor_id = ? AND ended_at IS NULL
        `
      )
      .run(
        input.endedAt,
        input.endedBy,
        input.cleanupReason,
        input.guildId,
        input.scopePlaceId,
        input.actorId
      );

    return result.changes > 0;
  }

  failClosedAllActive(input: {
    endedAt: string;
    endedBy: string;
    cleanupReason: string;
  }): number {
    const result = this.db
      .prepare(
        `
          UPDATE override_session
          SET
            ended_at = ?,
            ended_by = ?,
            cleanup_reason = ?
          WHERE ended_at IS NULL
        `
      )
      .run(input.endedAt, input.endedBy, input.cleanupReason);

    return result.changes;
  }
}

export class MessageProcessingRepository {
  constructor(private readonly db: Database.Database) {}

  tryAcquire(messageId: string, channelId: string, leaseMs = 5 * 60_000): boolean {
    const now = new Date();
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

    const transaction = this.db.transaction(() => {
      const existing = find.get(messageId) as MessageProcessingRow | undefined;
      if (!existing) {
        insert.run(messageId, channelId, leaseExpiresAt, nowIso, nowIso);
        return true;
      }

      if (existing.state === "completed") {
        return false;
      }

      if (!existing.lease_expires_at || existing.lease_expires_at > nowIso) {
        return false;
      }

      updateLease.run(channelId, leaseExpiresAt, nowIso, messageId);
      return true;
    });

    return transaction();
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
        insert.run(
          AppRuntimeLockRepository.lockName,
          instanceId,
          ownerPid,
          leaseExpiresAt
        );
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

      update.run(
        instanceId,
        ownerPid,
        leaseExpiresAt,
        AppRuntimeLockRepository.lockName
      );
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
      .run(
        leaseExpiresAt,
        ownerPid,
        AppRuntimeLockRepository.lockName,
        instanceId
      );

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
        .get(AppRuntimeLockRepository.lockName) as AppRuntimeLockRow | undefined) ??
      null
    );
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function mapOverrideSessionRow(row: OverrideSessionRow): OverrideSessionRecord {
  return {
    sessionId: row.session_id,
    guildId: row.guild_id,
    actorId: row.actor_id,
    grantedBy: row.granted_by,
    scopePlaceId: row.scope_place_id,
    flags: JSON.parse(row.flags_json) as OverrideFlags,
    sandboxMode: row.sandbox_mode,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    endedBy: row.ended_by,
    cleanupReason: row.cleanup_reason
  };
}




