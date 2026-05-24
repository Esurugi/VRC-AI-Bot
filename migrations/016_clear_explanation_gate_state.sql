CREATE TABLE clear_explanation_gate_state (
  thread_id TEXT PRIMARY KEY,
  root_channel_id TEXT NOT NULL,
  first_message_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (
    decision IN (
      'allow_clear_explanation',
      'redirect_to_general_question'
    )
  ),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_clear_explanation_gate_state_root_channel_id
  ON clear_explanation_gate_state(root_channel_id);
