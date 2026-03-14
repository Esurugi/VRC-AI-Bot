DROP TABLE IF EXISTS retry_job;

CREATE TABLE retry_job (
  message_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  message_channel_id TEXT NOT NULL,
  watch_channel_id TEXT NOT NULL,
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

CREATE INDEX idx_retry_job_next_attempt_at
  ON retry_job(next_attempt_at);
