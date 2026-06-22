import type {
  ActorRole,
  CodexSandboxMode,
  MessageEnvelope,
  Scope,
  WatchLocationConfig
} from "../domain/types.js";
import {
  isAmbientRoomChat,
  isKnowledgePlaceRootShare,
  isThreadEnvelope
} from "../domain/response-boundary.js";
import {
  hasPlaceFeature,
  isClearExplanationPlace,
  isForumResearchPlace
} from "../domain/place-features.js";

export const DEFAULT_CODEX_MODEL_PROFILE = "default:gpt-5.5";
export const DEFAULT_CODEX_MODEL = "gpt-5.5";
export const CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE = "chat:gpt-5.5:low";
export const AMBIENT_ROOM_CHAT_CODEX_MODEL_PROFILE = "ambient:gpt-5.5:low";
export const FORUM_LONGFORM_CODEX_MODEL_PROFILE = "forum:gpt-5.5:high";
export const FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE = "forum:gpt-5.5:low";
export const CLEAR_EXPLANATION_CODEX_MODEL_PROFILE =
  "clear_explanation:gpt-5.5:high";
export const CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE =
  "clear_explanation_gate:gpt-5.3-codex-spark:low";
export const RUNTIME_CONTRACT_VERSION = "2026-05-21.session-policy.v3";

export const SESSION_WORKLOAD_KIND_VALUES = [
  "conversation",
  "ambient_chat",
  "knowledge_ingest",
  "admin_override",
  "forum_longform",
  "clear_explanation"
] as const;
export type SessionWorkloadKind = (typeof SESSION_WORKLOAD_KIND_VALUES)[number];

export const SESSION_BINDING_KIND_VALUES = [
  "place",
  "thread",
  "message_origin"
] as const;
export type SessionBindingKind = (typeof SESSION_BINDING_KIND_VALUES)[number];

export const SESSION_LIFECYCLE_POLICY_VALUES = [
  "reusable",
  "ephemeral_turn",
  "explicit_close",
  "thread_lifetime"
] as const;
export type SessionLifecyclePolicy =
  (typeof SESSION_LIFECYCLE_POLICY_VALUES)[number];

export type SessionIdentityParts = {
  workloadKind: SessionWorkloadKind;
  bindingKind: SessionBindingKind;
  bindingId: string;
  actorId: string | null;
  sandboxMode: CodexSandboxMode;
  modelProfile: string;
  runtimeContractVersion: string;
  lifecyclePolicy: SessionLifecyclePolicy;
};

export type ResolvedSessionIdentity = SessionIdentityParts & {
  sessionIdentity: string;
};

type ResolveMessageSessionInput = {
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
  actorRole: ActorRole;
  scope: Scope;
  workspaceWriteActive: boolean;
};

export class SessionPolicyResolver {
  resolveForMessage(input: ResolveMessageSessionInput): ResolvedSessionIdentity {
    if (canUseAdminOverrideSession(input)) {
      return this.resolveAdminOverrideThread({
        threadId: input.envelope.channelId,
        actorId: input.envelope.authorId
      });
    }

    if (
      isForumResearchPlace(input.watchLocation) &&
      isThreadEnvelope(input.envelope)
    ) {
      return this.buildIdentity({
        workloadKind: "forum_longform",
        bindingKind: "thread",
        bindingId: input.envelope.channelId,
        actorId: null,
        sandboxMode: "read-only",
        lifecyclePolicy: "thread_lifetime",
        modelProfile: FORUM_LONGFORM_CODEX_MODEL_PROFILE
      });
    }

    if (
      isClearExplanationPlace(input.watchLocation) &&
      isThreadEnvelope(input.envelope)
    ) {
      return this.buildIdentity({
        workloadKind: "clear_explanation",
        bindingKind: "thread",
        bindingId: input.envelope.channelId,
        actorId: null,
        sandboxMode: "read-only",
        lifecyclePolicy: "thread_lifetime",
        modelProfile: CLEAR_EXPLANATION_CODEX_MODEL_PROFILE
      });
    }

    if (
      isAmbientRoomChat(input.watchLocation) &&
      !isThreadEnvelope(input.envelope)
    ) {
      return this.buildIdentity({
        workloadKind: "ambient_chat",
        bindingKind: "message_origin",
        bindingId: buildAmbientRoomBindingId(
          input.envelope.channelId,
          input.envelope.messageId
        ),
        actorId: null,
        sandboxMode: "read-only",
        lifecyclePolicy: "ephemeral_turn",
        modelProfile: AMBIENT_ROOM_CHAT_CODEX_MODEL_PROFILE
      });
    }

    if (isThreadEnvelope(input.envelope)) {
      return this.buildIdentity({
        workloadKind: "conversation",
        bindingKind: "thread",
        bindingId: input.envelope.channelId,
        actorId: null,
        sandboxMode: "read-only",
        lifecyclePolicy: "reusable",
        modelProfile: CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE
      });
    }

    if (
      isKnowledgePlaceRootShare({
        envelope: input.envelope,
        watchLocation: input.watchLocation
      })
    ) {
      return this.buildIdentity({
        workloadKind: "knowledge_ingest",
        bindingKind: "message_origin",
        bindingId: buildMessageOriginBindingId(
          input.envelope.channelId,
          input.envelope.messageId
        ),
        actorId: null,
        sandboxMode: "read-only",
        lifecyclePolicy: "reusable"
      });
    }

    return this.buildIdentity({
      workloadKind: "conversation",
      bindingKind: "place",
      bindingId: buildPlaceBindingId(input.envelope.channelId),
      actorId: null,
      sandboxMode: "read-only",
      lifecyclePolicy: "reusable",
      modelProfile: CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE
    });
  }

  resolveKnowledgeThreadConversation(input: {
    threadId: string;
  }): ResolvedSessionIdentity {
    return this.buildIdentity({
      workloadKind: "conversation",
      bindingKind: "thread",
      bindingId: input.threadId,
      actorId: null,
      sandboxMode: "read-only",
      lifecyclePolicy: "reusable",
      modelProfile: CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE
    });
  }

  resolveAdminOverrideThread(input: {
    threadId: string;
    actorId: string;
  }): ResolvedSessionIdentity {
    return this.buildIdentity({
      workloadKind: "admin_override",
      bindingKind: "thread",
      bindingId: input.threadId,
      actorId: input.actorId,
      sandboxMode: "workspace-write",
      lifecyclePolicy: "explicit_close"
    });
  }

  buildIdentity(
    parts: Omit<
      SessionIdentityParts,
      "modelProfile" | "runtimeContractVersion"
    > & {
      modelProfile?: string;
      runtimeContractVersion?: string;
    }
  ): ResolvedSessionIdentity {
    const identity: SessionIdentityParts = {
      modelProfile: parts.modelProfile ?? DEFAULT_CODEX_MODEL_PROFILE,
      runtimeContractVersion:
        parts.runtimeContractVersion ?? RUNTIME_CONTRACT_VERSION,
      workloadKind: parts.workloadKind,
      bindingKind: parts.bindingKind,
      bindingId: parts.bindingId,
      actorId: parts.actorId,
      sandboxMode: parts.sandboxMode,
      lifecyclePolicy: parts.lifecyclePolicy
    };

    return {
      ...identity,
      sessionIdentity: formatSessionIdentity(identity)
    };
  }
}

function canUseAdminOverrideSession(input: ResolveMessageSessionInput): boolean {
  return (
    input.workspaceWriteActive &&
    input.actorRole !== "user" &&
    hasPlaceFeature(input.watchLocation, "admin_override") &&
    isThreadEnvelope(input.envelope)
  );
}

export function formatSessionIdentity(parts: SessionIdentityParts): string {
  return [
    `workload=${parts.workloadKind}`,
    `binding_kind=${parts.bindingKind}`,
    `binding_id=${parts.bindingId}`,
    `actor_id=${parts.actorId ?? "-"}`,
    `sandbox=${parts.sandboxMode}`,
    `model=${parts.modelProfile}`,
    `contract=${parts.runtimeContractVersion}`,
    `lifecycle=${parts.lifecyclePolicy}`
  ].join("|");
}

export function buildPlaceBindingId(channelId: string): string {
  return channelId;
}

export function buildMessageOriginBindingId(
  channelId: string,
  messageId: string
): string {
  return `${channelId}:message:${messageId}`;
}

export function buildAmbientRoomBindingId(
  channelId: string,
  messageId: string
): string {
  return `${channelId}:ambient:${messageId}`;
}

export function resolveScopedPlaceId(input: {
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
}): string {
  if (isThreadEnvelope(input.envelope)) {
    return input.envelope.channelId;
  }

  if (
    isKnowledgePlaceRootShare({
      envelope: input.envelope,
      watchLocation: input.watchLocation
    })
  ) {
    return buildMessageOriginBindingId(
      input.envelope.channelId,
      input.envelope.messageId
    );
  }

  return buildPlaceBindingId(input.envelope.channelId);
}
