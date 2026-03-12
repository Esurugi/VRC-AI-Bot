ALTER TABLE codex_session RENAME TO codex_session_legacy;

CREATE TABLE IF NOT EXISTS codex_session_binding (
  session_identity TEXT PRIMARY KEY,
  workload_kind TEXT NOT NULL,
  binding_kind TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  actor_id TEXT,
  sandbox_mode TEXT NOT NULL,
  model_profile TEXT NOT NULL,
  runtime_contract_version TEXT NOT NULL,
  lifecycle_policy TEXT NOT NULL,
  codex_thread_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS codex_session_binding_lookup_idx
ON codex_session_binding (
  workload_kind,
  binding_kind,
  binding_id,
  actor_id,
  sandbox_mode,
  model_profile,
  runtime_contract_version
);
