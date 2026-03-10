import type { ActorRole, Scope, WatchMode } from "../domain/types.js";

export function buildPlainTextReply(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return "Codex から空の応答が返りました。";
  }

  return normalized.length <= 1900
    ? normalized
    : `${normalized.slice(0, 1900)}\n...[truncated]`;
}

export function buildAdminDiagnosticsReply(input: {
  messageId: string;
  placeMode: WatchMode;
  actorRole: ActorRole;
  resolvedScope: Scope;
  codexThreadId: string;
  notes: string | null;
}): string {
  return [
    "```json",
    JSON.stringify(
      {
        message_id: input.messageId,
        place_mode: input.placeMode,
        actor_role: input.actorRole,
        resolved_scope: input.resolvedScope,
        codex_thread_id: input.codexThreadId,
        notes: input.notes
      },
      null,
      2
    ),
    "```"
  ].join("\n");
}
