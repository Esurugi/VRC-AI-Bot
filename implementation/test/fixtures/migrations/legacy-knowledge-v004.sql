CREATE TABLE schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_migrations (name) VALUES
  ('001_initial.sql'),
  ('002_message_processing.sql'),
  ('003_app_runtime_lock.sql'),
  ('004_override_session_v2.sql');

CREATE TABLE watch_location (
  guild_id TEXT NOT NULL,
  channel_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  default_scope TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE channel_cursor (
  channel_id TEXT PRIMARY KEY,
  last_processed_message_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE codex_session (
  place_id TEXT PRIMARY KEY,
  codex_thread_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO codex_session (place_id, codex_thread_id, updated_at)
VALUES ('legacy-place-1', 'legacy-codex-thread-1', '2026-05-20T00:00:00.000Z');

CREATE TABLE knowledge_record (
  record_id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  scope TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX knowledge_record_dedupe
ON knowledge_record (canonical_url, content_hash, scope);

CREATE VIRTUAL TABLE knowledge_record_fts
USING fts5(
  canonical_url,
  domain,
  title,
  summary,
  tags,
  content='',
  tokenize='unicode61'
);

INSERT INTO knowledge_record (
  record_id,
  canonical_url,
  domain,
  title,
  summary,
  tags_json,
  scope,
  content_hash,
  created_at
) VALUES (
  'legacy-record-1',
  'https://legacy.example.com/public-note',
  'legacy.example.com',
  'Legacy Public Note',
  'Legacy summary that should remain available after migration.',
  '["legacy","ai"]',
  'server_public',
  'sha256:legacy-record-1',
  '2026-05-20T00:01:00.000Z'
);

CREATE TABLE knowledge_artifact (
  record_id TEXT PRIMARY KEY,
  final_url TEXT NOT NULL,
  snapshot_path TEXT NOT NULL,
  screenshot_path TEXT,
  network_log_path TEXT,
  FOREIGN KEY (record_id) REFERENCES knowledge_record(record_id)
);

INSERT INTO knowledge_artifact (
  record_id,
  final_url,
  snapshot_path,
  screenshot_path,
  network_log_path
) VALUES (
  'legacy-record-1',
  'https://legacy.example.com/public-note',
  'legacy/snapshot.html',
  NULL,
  NULL
);

CREATE TABLE source_link (
  link_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  reply_thread_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (record_id) REFERENCES knowledge_record(record_id)
);

INSERT INTO source_link (
  link_id,
  record_id,
  source_message_id,
  reply_thread_id,
  created_at
) VALUES (
  'legacy-link-1',
  'legacy-record-1',
  'legacy-message-1',
  'legacy-thread-1',
  '2026-05-20T00:03:00.000Z'
);

CREATE TABLE violation_event (
  event_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  violation_category TEXT NOT NULL,
  control_request_class TEXT NOT NULL,
  handled_as TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE TABLE sanction_state (
  sanction_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ends_at TEXT,
  reason TEXT NOT NULL
);

CREATE TABLE override_session (
  session_id TEXT PRIMARY KEY,
  granted_by TEXT NOT NULL,
  scope_place_id TEXT NOT NULL,
  flags_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ends_at TEXT,
  guild_id TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL DEFAULT '',
  sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',
  ended_at TEXT,
  ended_by TEXT,
  cleanup_reason TEXT
);

CREATE TABLE message_processing (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'completed')),
  lease_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE app_runtime_lock (
  lock_name TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  lease_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
