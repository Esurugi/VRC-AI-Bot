CREATE TABLE IF NOT EXISTS message_processing (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'completed')),
  lease_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_message_processing_channel_id
  ON message_processing(channel_id);
