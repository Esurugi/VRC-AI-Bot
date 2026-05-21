DROP INDEX IF EXISTS idx_retry_job_next_attempt_at;
ALTER TABLE retry_job RENAME TO retry_job_legacy_v1;

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

INSERT INTO retry_job (
  message_id,
  guild_id,
  message_channel_id,
  watch_channel_id,
  attempt_count,
  next_attempt_at,
  last_failure_category,
  reply_channel_id,
  reply_thread_id,
  place_mode,
  stage,
  created_at,
  updated_at
)
SELECT
  message_id,
  guild_id,
  channel_id,
  channel_id,
  attempt_count,
  next_attempt_at,
  last_failure_category,
  reply_channel_id,
  reply_thread_id,
  place_mode,
  stage,
  created_at,
  updated_at
FROM retry_job_legacy_v1;

DROP TABLE retry_job_legacy_v1;
