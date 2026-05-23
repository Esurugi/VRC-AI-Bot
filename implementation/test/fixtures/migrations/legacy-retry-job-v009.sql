CREATE TABLE schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_migrations (name) VALUES
  ('001_initial.sql'),
  ('002_message_processing.sql'),
  ('003_app_runtime_lock.sql'),
  ('004_override_session_v2.sql'),
  ('005_knowledge_retrieval_v2.sql'),
  ('006_codex_session_binding_v1.sql'),
  ('007_sanction_v1.sql'),
  ('008_retry_scheduler_v1.sql'),
  ('009_runtime_feature_ready_v1.sql');

CREATE TABLE retry_job (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  next_attempt_at TEXT NOT NULL,
  last_failure_category TEXT NOT NULL,
  reply_channel_id TEXT NOT NULL,
  reply_thread_id TEXT,
  place_mode TEXT NOT NULL,
  stage TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO retry_job (
  message_id,
  channel_id,
  guild_id,
  attempt_count,
  next_attempt_at,
  last_failure_category,
  reply_channel_id,
  reply_thread_id,
  place_mode,
  stage,
  created_at,
  updated_at
) VALUES (
  'legacy-retry-message-1',
  'legacy-channel-1',
  'guild-1',
  3,
  '2026-05-21T01:00:00.000Z',
  'transient',
  'legacy-channel-1',
  'legacy-thread-1',
  'url_watch',
  'dispatch',
  '2026-05-21T00:00:00.000Z',
  '2026-05-21T00:30:00.000Z'
);
