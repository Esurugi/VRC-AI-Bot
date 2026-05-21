CREATE TABLE IF NOT EXISTS message_processing (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'pending_retry', 'completed')),
  lease_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

DROP INDEX IF EXISTS idx_message_processing_channel_id;
ALTER TABLE message_processing RENAME TO message_processing_legacy_terminal_failure;

CREATE TABLE message_processing (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN (
      'processing',
      'pending_retry',
      'completed',
      'terminal_failure_notified'
    )
  ),
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
FROM message_processing_legacy_terminal_failure;

DROP TABLE message_processing_legacy_terminal_failure;

CREATE INDEX idx_message_processing_channel_id
  ON message_processing(channel_id);
