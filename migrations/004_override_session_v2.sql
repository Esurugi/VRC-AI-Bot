ALTER TABLE override_session
ADD COLUMN guild_id TEXT NOT NULL DEFAULT '';

ALTER TABLE override_session
ADD COLUMN actor_id TEXT NOT NULL DEFAULT '';

ALTER TABLE override_session
ADD COLUMN sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write';

ALTER TABLE override_session
ADD COLUMN ended_at TEXT;

ALTER TABLE override_session
ADD COLUMN ended_by TEXT;

ALTER TABLE override_session
ADD COLUMN cleanup_reason TEXT;

UPDATE override_session
SET ended_at = ends_at
WHERE ended_at IS NULL AND ends_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS override_session_scope_actor_idx
ON override_session (guild_id, scope_place_id, actor_id, started_at);

CREATE UNIQUE INDEX IF NOT EXISTS override_session_active_actor_place_idx
ON override_session (guild_id, scope_place_id, actor_id)
WHERE ended_at IS NULL AND guild_id <> '' AND actor_id <> '';
