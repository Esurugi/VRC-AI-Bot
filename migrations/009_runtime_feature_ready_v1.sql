CREATE TABLE IF NOT EXISTS chat_channel_counter (
  channel_id TEXT PRIMARY KEY,
  ordinary_message_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scheduled_delivery (
  event_key TEXT NOT NULL,
  occurrence_date TEXT NOT NULL,
  delivered_at TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NULL,
  PRIMARY KEY (event_key, occurrence_date)
);
