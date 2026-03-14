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

CREATE INDEX idx_forum_research_state_thread_id
  ON forum_research_state(thread_id);
