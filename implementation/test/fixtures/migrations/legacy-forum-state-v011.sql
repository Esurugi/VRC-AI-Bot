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
  ('011_forum_research_state.sql');

CREATE TABLE forum_research_state (
  session_identity TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  last_message_id TEXT NOT NULL,
  planner_brief TEXT,
  evidence_gaps_json TEXT NOT NULL,
  worker_results_json TEXT NOT NULL,
  source_catalog_json TEXT NOT NULL,
  distinct_sources_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO forum_research_state (
  session_identity,
  thread_id,
  last_message_id,
  planner_brief,
  evidence_gaps_json,
  worker_results_json,
  source_catalog_json,
  distinct_sources_json,
  created_at,
  updated_at
) VALUES (
  'forum-session-legacy',
  'forum-thread-legacy',
  'forum-message-legacy',
  'Legacy planner brief',
  '[{"gap":"confirm source freshness"}]',
  '[{"worker":"source-check","summary":"Found one public source."}]',
  '[{"url":"https://legacy.example.com/source"}]',
  '["https://legacy.example.com/source"]',
  '2026-05-21T00:00:00.000Z',
  '2026-05-21T00:30:00.000Z'
);
