import type { Logger } from "pino";

import type { CodexAppServerClient } from "./app-server-client.js";
import { resolveCodexExecutionProfile } from "./execution-profile.js";
import { type ResolvedSessionIdentity } from "./session-policy.js";
import { appendRuntimeTrace } from "../observability/runtime-trace.js";
import type { SqliteStore } from "../storage/database.js";

type LiveSessionRecord = {
  threadId: string;
  generation: number;
};

export class SessionManager {
  private readonly liveSessions = new Map<string, LiveSessionRecord>();
  private cachedGeneration = 0;

  constructor(
    private readonly store: SqliteStore,
    private readonly codexClient: CodexAppServerClient,
    private readonly logger: Logger
  ) {}

  async getOrStartSession(identity: ResolvedSessionIdentity): Promise<{
    threadId: string;
    startedFresh: boolean;
  }> {
    if (identity.lifecyclePolicy === "ephemeral_turn") {
      return this.startEphemeralSession(identity);
    }

    this.syncInvalidationGeneration();

    const live = this.liveSessions.get(identity.sessionIdentity);
    if (live) {
      return this.resumeTrackedSession(identity, live.threadId);
    }

    if (this.cachedGeneration === 0) {
      const persisted = this.store.codexSessions.get(identity.sessionIdentity);
      if (persisted) {
        return this.resumePersistedSession(identity, persisted.codex_thread_id);
      }
    }

    return this.startFreshSession(identity);
  }

  bindSession(identity: ResolvedSessionIdentity, threadId: string): void {
    if (identity.lifecyclePolicy === "ephemeral_turn") {
      return;
    }

    this.syncInvalidationGeneration();
    this.store.codexSessions.upsert({
      sessionIdentity: identity.sessionIdentity,
      workloadKind: identity.workloadKind,
      bindingKind: identity.bindingKind,
      bindingId: identity.bindingId,
      actorId: identity.actorId,
      sandboxMode: identity.sandboxMode,
      modelProfile: identity.modelProfile,
      runtimeContractVersion: identity.runtimeContractVersion,
      lifecyclePolicy: identity.lifecyclePolicy,
      codexThreadId: threadId
    });
    this.liveSessions.set(identity.sessionIdentity, {
      threadId,
      generation: this.cachedGeneration
    });
    appendRuntimeTrace("codex-app-server", "session_binding_upserted", {
      session_identity: identity.sessionIdentity,
      workload_kind: identity.workloadKind,
      codex_thread_id: threadId,
      runtime_contract_version: identity.runtimeContractVersion
    });
  }

  async archiveSession(identity: ResolvedSessionIdentity): Promise<{
    archived: boolean;
    threadId: string | null;
  }> {
    this.syncInvalidationGeneration();
    const binding = this.store.codexSessions.get(identity.sessionIdentity);
    if (!binding) {
      return {
        archived: false,
        threadId: null
      };
    }

    await this.codexClient.archiveThread(binding.codex_thread_id);
    try {
      await this.codexClient.unsubscribeThread(binding.codex_thread_id);
    } catch (error) {
      this.logger.debug(
        {
          error: error instanceof Error ? error.message : String(error),
          codexThreadId: binding.codex_thread_id,
          sessionIdentity: identity.sessionIdentity
        },
        "failed to unsubscribe archived codex thread"
      );
    }

    this.store.codexSessions.delete(identity.sessionIdentity);
    this.liveSessions.delete(identity.sessionIdentity);
    appendRuntimeTrace("codex-app-server", "session_archived", {
      session_identity: identity.sessionIdentity,
      workload_kind: identity.workloadKind,
      codex_thread_id: binding.codex_thread_id,
      runtime_contract_version: identity.runtimeContractVersion
    });
    return {
      archived: true,
      threadId: binding.codex_thread_id
    };
  }

  invalidateReusableSessions(reason: string): void {
    this.liveSessions.clear();
    appendRuntimeTrace("codex-app-server", "session_cache_invalidated", {
      reason,
      generation: this.cachedGeneration
    });
  }

  private syncInvalidationGeneration(): void {
    const generation = this.codexClient.getSessionInvalidationGeneration();
    if (generation === this.cachedGeneration) {
      return;
    }

    this.cachedGeneration = generation;
    this.invalidateReusableSessions("codex_skills_changed");
  }

  private async resumeTrackedSession(
    identity: ResolvedSessionIdentity,
    threadId: string
  ): Promise<{ threadId: string; startedFresh: boolean }> {
    try {
      await this.codexClient.resumeThread(threadId, identity.sandboxMode);
      appendRuntimeTrace("codex-app-server", "session_resumed", {
        session_identity: identity.sessionIdentity,
        workload_kind: identity.workloadKind,
        codex_thread_id: threadId,
        runtime_contract_version: identity.runtimeContractVersion,
        resume_source: "live_cache"
      });
      return {
        threadId,
        startedFresh: false
      };
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          sessionIdentity: identity.sessionIdentity,
          codexThreadId: threadId
        },
        "failed to resume cached codex session; starting a new thread"
      );
      this.liveSessions.delete(identity.sessionIdentity);
      return this.startFreshSession(identity);
    }
  }

  private async resumePersistedSession(
    identity: ResolvedSessionIdentity,
    threadId: string
  ): Promise<{ threadId: string; startedFresh: boolean }> {
    try {
      await this.codexClient.resumeThread(threadId, identity.sandboxMode);
      this.liveSessions.set(identity.sessionIdentity, {
        threadId,
        generation: this.cachedGeneration
      });
      appendRuntimeTrace("codex-app-server", "session_resumed", {
        session_identity: identity.sessionIdentity,
        workload_kind: identity.workloadKind,
        codex_thread_id: threadId,
        runtime_contract_version: identity.runtimeContractVersion,
        resume_source: "persistent_binding"
      });
      return {
        threadId,
        startedFresh: false
      };
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          sessionIdentity: identity.sessionIdentity,
          codexThreadId: threadId
        },
        "failed to resume persisted codex session; starting a new thread"
      );
      return this.startFreshSession(identity);
    }
  }

  private async startFreshSession(
    identity: ResolvedSessionIdentity
  ): Promise<{ threadId: string; startedFresh: boolean }> {
    const executionProfile = resolveCodexExecutionProfile(identity.modelProfile);
    const threadId = await this.codexClient.startThread(
      identity.sandboxMode,
      executionProfile
    );
    this.bindSession(identity, threadId);
    appendRuntimeTrace("codex-app-server", "session_started", {
      session_identity: identity.sessionIdentity,
      workload_kind: identity.workloadKind,
      codex_thread_id: threadId,
      runtime_contract_version: identity.runtimeContractVersion,
      model_profile: identity.modelProfile
    });
    return {
      threadId,
      startedFresh: true
    };
  }

  private async startEphemeralSession(
    identity: ResolvedSessionIdentity
  ): Promise<{ threadId: string; startedFresh: boolean }> {
    const executionProfile = resolveCodexExecutionProfile(identity.modelProfile);
    const threadId = await this.codexClient.startThread(
      identity.sandboxMode,
      executionProfile
    );
    appendRuntimeTrace("codex-app-server", "session_started", {
      session_identity: identity.sessionIdentity,
      workload_kind: identity.workloadKind,
      codex_thread_id: threadId,
      runtime_contract_version: identity.runtimeContractVersion,
      model_profile: identity.modelProfile,
      ephemeral: true
    });
    return {
      threadId,
      startedFresh: true
    };
  }
}
