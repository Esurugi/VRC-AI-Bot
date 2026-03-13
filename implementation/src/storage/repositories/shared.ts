import type { OverrideFlags, OverrideSessionRecord } from "../../override/types.js";
import type {
  Scope,
  ThreadKnowledgeContextRow,
  VisibleCandidate,
  OverrideSessionRow
} from "../types.js";

export function buildInClause(size: number): string {
  return Array.from({ length: size }, () => "?").join(", ");
}

export function mapVisibleCandidate(row: ThreadKnowledgeContextRow): VisibleCandidate {
  return {
    sourceId: row.record_id,
    title: row.title,
    summary: row.summary,
    tags: JSON.parse(row.tags_json) as string[],
    scope: row.scope as Scope,
    recency: row.created_at,
    canonicalUrl: row.canonical_url
  };
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function mapOverrideSessionRow(row: OverrideSessionRow): OverrideSessionRecord {
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
