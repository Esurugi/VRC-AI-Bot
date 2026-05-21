CREATE TABLE IF NOT EXISTS watch_location (
  guild_id TEXT NOT NULL,
  channel_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  default_scope TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE watch_location
ADD COLUMN feature_profile_id TEXT;

ALTER TABLE watch_location
ADD COLUMN features_json TEXT;

ALTER TABLE watch_location
ADD COLUMN chat_behavior TEXT;

ALTER TABLE watch_location
ADD COLUMN chat_behavior_present INTEGER NOT NULL DEFAULT 0;
