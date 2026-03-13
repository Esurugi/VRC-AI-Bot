ALTER TABLE violation_event
ADD COLUMN counts_toward_threshold INTEGER NOT NULL DEFAULT 1;

ALTER TABLE violation_event
ADD COLUMN actor_role TEXT NOT NULL DEFAULT 'user';

ALTER TABLE sanction_state
ADD COLUMN trigger_event_id TEXT NULL;

ALTER TABLE sanction_state
ADD COLUMN action TEXT NOT NULL DEFAULT 'soft_block';

ALTER TABLE sanction_state
ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'applied';

CREATE INDEX IF NOT EXISTS violation_event_countable_actor_idx
ON violation_event (guild_id, user_id, counts_toward_threshold, occurred_at);

CREATE INDEX IF NOT EXISTS sanction_state_action_actor_idx
ON sanction_state (guild_id, user_id, action, started_at);

CREATE TABLE IF NOT EXISTS soft_block_notice (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  last_notified_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, channel_id)
);

