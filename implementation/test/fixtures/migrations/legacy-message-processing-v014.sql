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
  ('009_runtime_feature_ready_v1.sql'),
  ('010_retry_scheduler_v2.sql'),
  ('011_forum_research_state.sql'),
  ('012_forum_research_state_v2.sql'),
  ('013_forum_research_prompt_artifact.sql'),
  ('014_watch_location_capabilities_v1.sql');

CREATE TABLE message_processing (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'pending_retry', 'completed')),
  lease_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX idx_message_processing_channel_id
  ON message_processing(channel_id);

INSERT INTO message_processing (
  message_id,
  channel_id,
  state,
  lease_expires_at,
  created_at,
  updated_at,
  completed_at
) VALUES
  (
    'legacy-processing-message',
    'legacy-channel-1',
    'processing',
    '2026-05-21T00:10:00.000Z',
    '2026-05-21T00:00:00.000Z',
    '2026-05-21T00:00:00.000Z',
    NULL
  ),
  (
    'legacy-retry-message',
    'legacy-channel-1',
    'pending_retry',
    NULL,
    '2026-05-21T00:00:00.000Z',
    '2026-05-21T00:01:00.000Z',
    NULL
  ),
  (
    'legacy-completed-message',
    'legacy-channel-1',
    'completed',
    NULL,
    '2026-05-21T00:00:00.000Z',
    '2026-05-21T00:02:00.000Z',
    '2026-05-21T00:02:00.000Z'
  );
