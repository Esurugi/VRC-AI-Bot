CREATE TABLE thread_workflow_route (
  thread_id TEXT PRIMARY KEY,
  root_channel_id TEXT NOT NULL,
  first_message_id TEXT NOT NULL,
  workflow TEXT NOT NULL CHECK (
    workflow IN (
      'clear_explanation',
      'forum_research'
    )
  ),
  selected_by TEXT NOT NULL CHECK (
    selected_by IN (
      'starter_gateway',
      'command'
    )
  ),
  selected_by_actor_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_thread_workflow_route_root_channel_id
  ON thread_workflow_route(root_channel_id);
