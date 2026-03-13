import Database from "better-sqlite3";

import type { OverrideFlags, OverrideSessionRecord } from "../../override/types.js";
import type { OverrideSessionRow } from "../types.js";
import { mapOverrideSessionRow } from "./shared.js";

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
