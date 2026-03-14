import type { ActorRole, Scope, WatchMode } from "../domain/types.js";
import type { FailurePublicCategory, FailureStage } from "./failure-classifier.js";
import type { SanctionNotificationPayload } from "./moderation-integration.js";

const DISCORD_TEXT_LIMIT = 1900;

export function buildPlainTextReply(text: string): string {
  return splitPlainTextReplies(text)[0] ?? "Codex から空の応答が返りました。";
}

export function splitPlainTextReplies(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return ["Codex から空の応答が返りました。"];
  }

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > DISCORD_TEXT_LIMIT) {
    const splitAt = findSplitPoint(remaining, DISCORD_TEXT_LIMIT);
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function findSplitPoint(text: string, limit: number): number {
  const candidateBreaks = [
    text.lastIndexOf("\n\n", limit),
    text.lastIndexOf("\n", limit),
    text.lastIndexOf("。", limit),
    text.lastIndexOf(" ", limit)
  ].filter((index) => index >= Math.floor(limit * 0.5));

  return candidateBreaks[0] ?? limit;
}

export function buildAdminDiagnosticsReply(input: {
  messageId: string;
  placeMode: WatchMode;
  actorRole: ActorRole;
  resolvedScope: Scope;
  codexThreadId: string;
  sessionIdentity: string;
  workloadKind: string;
  modelProfile: string;
  runtimeContractVersion: string;
  notes: string | null;
}): string {
  return buildJsonCodeBlock({
    message_id: input.messageId,
    place_mode: input.placeMode,
    actor_role: input.actorRole,
    resolved_scope: input.resolvedScope,
    codex_thread_id: input.codexThreadId,
    session_identity: input.sessionIdentity,
    workload_kind: input.workloadKind,
    model_profile: input.modelProfile,
    runtime_contract_version: input.runtimeContractVersion,
    notes: input.notes
  });
}

export function buildSanctionStateChangeReply(
  input: SanctionNotificationPayload
): string {
  return buildJsonCodeBlock({
    type: "sanction_state_change",
    guild_id: input.guild_id,
    user_id: input.user_id,
    message_id: input.message_id,
    violation_category: input.violation_category,
    control_request_class: input.control_request_class,
    action: input.action,
    delivery_status: input.delivery_status,
    duration: input.duration,
    reason: input.reason
  });
}

export function buildPermanentFailureReply(input: {
  messageId: string;
  placeMode: WatchMode;
  channelId: string;
  error: string;
  stage?: FailureStage;
  category?: FailurePublicCategory;
}): string {
  return buildJsonCodeBlock({
    type: "permanent_failure",
    message_id: input.messageId,
    place_mode: input.placeMode,
    channel_id: input.channelId,
    error: input.error,
    ...(input.stage ? { stage: input.stage } : {}),
    ...(input.category ? { category: input.category } : {})
  });
}

export function buildFailureNotice(input: {
  category: FailurePublicCategory;
  delayMs?: number | null;
  retryable?: boolean;
}): string {
  switch (input.category) {
    case "public_page_unavailable":
      return "公開ページではないため処理できません。";
    case "fetch_timeout":
      if (input.retryable === false || input.delayMs == null) {
        return "取得がタイムアウトしたため処理できません。";
      }
      return buildRetryNotice("取得がタイムアウトしたため", input.delayMs);
    case "permission_denied":
      return "権限不足で読めないため処理できません。";
    case "unsupported_place":
      return "この場所では扱えないため処理できません。";
    case "ai_processing_failed":
      if (input.retryable === false || input.delayMs == null) {
        return "AI処理に失敗したため処理できません。";
      }
      return buildRetryNotice("AI処理に失敗したため", input.delayMs);
    case "retry_limit_reached":
      return "再試行上限に達したため処理を終了します。";
  }
}

function formatRetryDelay(delayMs?: number | null): string {
  if (delayMs == null) {
    return "しばらく";
  }

  if (delayMs <= 0) {
    return "すぐ";
  }

  const seconds = Math.round(delayMs / 1_000);
  if (seconds < 60) {
    return `${seconds}秒`;
  }

  const minutes = Math.round(delayMs / 60_000);
  if (minutes < 60) {
    return `${minutes}分`;
  }
  return `${Math.round(minutes / 60)}時間`;
}

function buildRetryNotice(prefix: string, delayMs: number): string {
  if (delayMs <= 0) {
    return `${prefix}、すぐに再試行します。`;
  }

  return `${prefix}、${formatRetryDelay(delayMs)}後に再試行します。`;
}

function buildJsonCodeBlock(payload: unknown): string {
  return [
    "```json",
    JSON.stringify(payload, null, 2),
    "```"
  ].join("\n");
}
