CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS watch_location (
  guild_id TEXT NOT NULL,
  channel_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  default_scope TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channel_cursor (
  channel_id TEXT PRIMARY KEY,
  last_processed_message_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS codex_session (
  place_id TEXT PRIMARY KEY,
  codex_thread_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_record (
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

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_record_dedupe
ON knowledge_record (canonical_url, content_hash, scope);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_record_fts
USING fts5(
  canonical_url,
  domain,
  title,
  summary,
  tags,
  content='',
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS knowledge_artifact (
  record_id TEXT PRIMARY KEY,
  final_url TEXT NOT NULL,
  snapshot_path TEXT NOT NULL,
  screenshot_path TEXT,
  network_log_path TEXT,
  FOREIGN KEY (record_id) REFERENCES knowledge_record(record_id)
);

CREATE TABLE IF NOT EXISTS source_link (
  link_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  reply_thread_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (record_id) REFERENCES knowledge_record(record_id)
);

CREATE TABLE IF NOT EXISTS violation_event (
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

CREATE INDEX IF NOT EXISTS violation_event_actor_idx
ON violation_event (guild_id, user_id, occurred_at);

CREATE TABLE IF NOT EXISTS sanction_state (
  sanction_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ends_at TEXT,
  reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sanction_state_actor_idx
ON sanction_state (guild_id, user_id, started_at);

CREATE TABLE IF NOT EXISTS override_session (
  session_id TEXT PRIMARY KEY,
  granted_by TEXT NOT NULL,
  scope_place_id TEXT NOT NULL,
  flags_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ends_at TEXT
);
