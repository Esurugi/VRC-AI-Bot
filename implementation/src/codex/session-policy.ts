import type {
  ActorRole,
  CodexSandboxMode,
  MessageEnvelope,
  Scope,
  WatchLocationConfig
} from "../domain/types.js";

export const DEFAULT_CODEX_MODEL_PROFILE = "default:gpt-5.4";
export const DEFAULT_CODEX_MODEL = "gpt-5.4";
export const RUNTIME_CONTRACT_VERSION = "2026-03-12.session-policy.v1";

export const SESSION_WORKLOAD_KIND_VALUES = [
  "conversation",
  "knowledge_ingest",
  "admin_override"
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
  "explicit_close"
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
    if (input.workspaceWriteActive) {
      return this.resolveAdminOverrideThread({
        threadId: input.envelope.channelId,
        actorId: input.envelope.authorId
      });
    }

    if (input.envelope.placeType.endsWith("thread")) {
      return this.buildIdentity({
        workloadKind: "conversation",
        bindingKind: "thread",
        bindingId: input.envelope.channelId,
        actorId: null,
        sandboxMode: "read-only",
        lifecyclePolicy: "reusable"
      });
    }

    if (
      input.watchLocation.mode === "url_watch" &&
      input.envelope.urls.length > 0
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
      bindingId: buildPlaceBindingId(
        input.envelope.channelId,
        input.watchLocation.mode
      ),
      actorId: null,
      sandboxMode: "read-only",
      lifecyclePolicy: "reusable"
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
      lifecyclePolicy: "reusable"
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

export function buildPlaceBindingId(
  channelId: string,
  mode: WatchLocationConfig["mode"]
): string {
  return `${channelId}:${mode}`;
}

export function buildMessageOriginBindingId(
  channelId: string,
  messageId: string
): string {
  return `${channelId}:message:${messageId}`;
}

export function resolveScopedPlaceId(input: {
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
}): string {
  if (input.envelope.placeType.endsWith("thread")) {
    return input.envelope.channelId;
  }

  if (
    input.envelope.urls.length > 0 &&
    input.watchLocation.mode === "url_watch"
  ) {
    return buildMessageOriginBindingId(
      input.envelope.channelId,
      input.envelope.messageId
    );
  }

  return buildPlaceBindingId(input.envelope.channelId, input.watchLocation.mode);
}
