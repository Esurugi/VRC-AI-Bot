ALTER TABLE message_processing RENAME TO message_processing_legacy_v1;

CREATE TABLE IF NOT EXISTS message_processing (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'pending_retry', 'completed')),
  lease_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

INSERT INTO message_processing (
  message_id,
  channel_id,
  state,
  lease_expires_at,
  created_at,
  updated_at,
  completed_at
)
SELECT
  message_id,
  channel_id,
  state,
  lease_expires_at,
  created_at,
  updated_at,
  completed_at
FROM message_processing_legacy_v1;

DROP TABLE message_processing_legacy_v1;

CREATE INDEX IF NOT EXISTS idx_message_processing_channel_id
  ON message_processing(channel_id);

CREATE TABLE IF NOT EXISTS retry_job (
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

CREATE INDEX IF NOT EXISTS idx_retry_job_next_attempt_at
  ON retry_job(next_attempt_at);
