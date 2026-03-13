import Database from "better-sqlite3";

import type { Scope, VisibleCandidate, WatchLocationConfig } from "../../domain/types.js";
import type {
  KnowledgeArtifactRow,
  KnowledgeRecordRow,
  KnowledgeSourceTextRow,
  SourceLinkRow,
  ThreadKnowledgeContextRow
} from "../types.js";
import { buildInClause, mapVisibleCandidate } from "./shared.js";

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
        .get(canonicalUrl, contentHash, scope, visibilityKey) as KnowledgeRecordRow | undefined) ??
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
      .all(canonicalUrl, ...allowedScopes, ...allowedVisibilityKeys)
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
      .run(input.recordId, input.normalizedText, input.sourceKind, input.capturedAt);
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
