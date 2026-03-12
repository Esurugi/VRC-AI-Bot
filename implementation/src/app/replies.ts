import type { ActorRole, Scope, WatchMode } from "../domain/types.js";

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
  return [
    "```json",
    JSON.stringify(
      {
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
      },
      null,
      2
    ),
    "```"
  ].join("\n");
}
