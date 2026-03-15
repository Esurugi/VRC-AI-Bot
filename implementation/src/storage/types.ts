import type {
  ActorRole,
  CodexSandboxMode,
  Scope,
  VisibleCandidate,
  WatchLocationConfig
} from "../domain/types.js";
import type {
  SessionBindingKind,
  SessionLifecyclePolicy,
  SessionWorkloadKind
} from "../codex/session-policy.js";

export type WatchLocationRow = {
  guild_id: string;
  channel_id: string;
  mode: WatchLocationConfig["mode"];
  default_scope: WatchLocationConfig["defaultScope"];
};

export type ChannelCursorRow = {
  channel_id: string;
  last_processed_message_id: string;
  updated_at: string;
};

export type CodexSessionBindingRow = {
  session_identity: string;
  workload_kind: SessionWorkloadKind;
  binding_kind: SessionBindingKind;
  binding_id: string;
  actor_id: string | null;
  sandbox_mode: CodexSandboxMode;
  model_profile: string;
  runtime_contract_version: string;
  lifecycle_policy: SessionLifecyclePolicy;
  codex_thread_id: string;
  created_at: string;
  updated_at: string;
};

export type KnowledgeRecordRow = {
  record_id: string;
  canonical_url: string;
  domain: string;
  title: string;
  summary: string;
  tags_json: string;
  scope: WatchLocationConfig["defaultScope"];
  visibility_key: string;
  content_hash: string;
  created_at: string;
};

export type KnowledgeArtifactRow = {
  record_id: string;
  final_url: string;
  snapshot_path: string;
  screenshot_path: string | null;
  network_log_path: string | null;
};

export type KnowledgeSourceTextRow = {
  record_id: string;
  normalized_text: string;
  source_kind: string;
  captured_at: string;
};

export type SourceLinkRow = {
  link_id: string;
  record_id: string;
  source_message_id: string;
  reply_thread_id: string | null;
  created_at: string;
};

export type ThreadKnowledgeContextRow = {
  source_message_id: string;
  record_id: string;
  canonical_url: string;
  title: string;
  summary: string;
  tags_json: string;
  scope: WatchLocationConfig["defaultScope"];
  created_at: string;
};

export type MessageProcessingRow = {
  message_id: string;
  channel_id: string;
  state: "processing" | "pending_retry" | "completed";
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type RetryJobRow = {
  message_id: string;
  guild_id: string;
  message_channel_id: string;
  watch_channel_id: string;
  attempt_count: number;
  next_attempt_at: string;
  last_failure_category: string;
  reply_channel_id: string;
  reply_thread_id: string | null;
  place_mode: WatchLocationConfig["mode"];
  stage: string;
  created_at: string;
  updated_at: string;
};

export type ForumResearchStateRow = {
  session_identity: string;
  thread_id: string;
  last_message_id: string;
  evidence_items_json: string;
  source_catalog_json: string;
  distinct_sources_json: string;
  created_at: string;
  updated_at: string;
};

export type ForumResearchPromptArtifactRow = {
  session_identity: string;
  thread_id: string;
  last_message_id: string;
  refined_prompt: string;
  progress_notice: string | null;
  prompt_rationale_summary: string | null;
  created_at: string;
  updated_at: string;
};

export type AppRuntimeLockRow = {
  lock_name: string;
  instance_id: string;
  owner_pid: number;
  lease_expires_at: string;
  created_at: string;
  updated_at: string;
};

export type OverrideSessionRow = {
  session_id: string;
  guild_id: string;
  actor_id: string;
  granted_by: string;
  scope_place_id: string;
  flags_json: string;
  sandbox_mode: "workspace-write";
  started_at: string;
  ended_at: string | null;
  ended_by: string | null;
  cleanup_reason: string | null;
};

export type ViolationEventRow = {
  event_id: string;
  guild_id: string;
  user_id: string;
  message_id: string;
  place_id: string;
  violation_category: string;
  control_request_class: string;
  handled_as: string;
  counts_toward_threshold: number;
  actor_role: ActorRole;
  occurred_at: string;
};

export type SanctionStateRow = {
  sanction_id: string;
  guild_id: string;
  user_id: string;
  state: string;
  action: "timeout" | "soft_block" | "kick";
  delivery_status: "applied" | "fallback" | "failed";
  trigger_event_id: string | null;
  started_at: string;
  ends_at: string | null;
  reason: string;
};

export type SoftBlockNoticeRow = {
  guild_id: string;
  user_id: string;
  channel_id: string;
  last_notified_at: string;
};

export type ChatChannelCounterRow = {
  channel_id: string;
  ordinary_message_count: number;
  updated_at: string;
};

export type ScheduledDeliveryRow = {
  event_key: string;
  occurrence_date: string;
  delivered_at: string;
  channel_id: string;
  message_id: string | null;
};

export type { Scope, VisibleCandidate };
