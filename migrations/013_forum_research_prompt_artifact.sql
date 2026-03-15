CREATE TABLE forum_research_prompt_artifact (
  session_identity TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  last_message_id TEXT NOT NULL,
  refined_prompt TEXT NOT NULL,
  progress_notice TEXT,
  prompt_rationale_summary TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_forum_research_prompt_artifact_thread_id
  ON forum_research_prompt_artifact(thread_id);
