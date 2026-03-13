import assert from "node:assert/strict";
import test from "node:test";
import type { AnyThreadChannel } from "discord.js";

import { AdminOverrideBootstrapService } from "../src/runtime/admin/admin-override-bootstrap-service.js";

test("AdminOverrideBootstrapService routes hidden prompt and dispatches only the bot response", async () => {
  const dispatchCalls: unknown[] = [];
  const moderationCalls: unknown[] = [];
  const thread = createThread();
  const service = new AdminOverrideBootstrapService(
    {
      async routeMessage(input: unknown) {
        return {
          response: {
            outcome: "chat_reply",
            repo_write_intent: false,
            public_text: "最初の応答です。",
            reply_mode: "same_place",
            target_thread_id: null,
            selected_source_ids: [],
            sources_used: [],
            knowledge_writes: [],
            diagnostics: {
              notes: null
            },
            sensitivity_raise: "none"
          },
          session: {
            identity: {
              sessionIdentity: "session-1",
              workloadKind: "admin_override",
              actorId: "admin-1",
              scopeKey: "thread-1",
              sandboxMode: "workspace-write",
              modelProfile: "default:gpt-5.4",
              runtimeContractVersion: "v1"
            },
            threadId: "codex-thread-1",
            startedFresh: true
          },
          knowledgePersistenceScope: null,
          moderationSignal: {
            violation_category: "none",
            control_request_class: null,
            notes: null
          },
          violationCounterSuspended: false
        };
      }
    } as never,
    {
      async dispatchHarnessResponseToChannel(input: unknown) {
        dispatchCalls.push(input);
        return {
          channelId: "thread-1",
          threadId: "thread-1"
        };
      },
      async notifySanctionStateChange() {},
      async sendChunksToChannel() {
        throw new Error("sendChunksToChannel should not be called");
      },
      async notifyPermanentFailure() {
        throw new Error("notifyPermanentFailure should not be called");
      }
    } as never,
    {
      classify() {
        throw new Error("classify should not be called");
      }
    } as never,
    {
      async checkSoftBlock() {
        return {
          blocked: false,
          notice_text: null
        };
      },
      async afterResponse(input: unknown) {
        moderationCalls.push(input);
      }
    },
    {} as never,
    {
      warn() {
        throw new Error("warn should not be called");
      }
    }
  );

  await service.bootstrapPrompt({
    thread,
    watchLocation: {
      guildId: "guild-1",
      channelId: "admin-root-1",
      mode: "admin_control",
      defaultScope: "server_public"
    },
    actorId: "admin-1",
    actorRole: "admin",
    prompt: "この機能の実装計画を立てて",
    requestId: "override-bootstrap:1"
  });

  assert.equal(dispatchCalls.length, 1);
  assert.equal(moderationCalls.length, 1);
  const dispatchInput = dispatchCalls[0] as {
    messageContext: {
      envelope: {
        content: string;
      };
    };
  };
  assert.equal(
    dispatchInput.messageContext.envelope.content,
    "この機能の実装計画を立てて"
  );
  assert.deepEqual(thread.sent, []);
});

test("AdminOverrideBootstrapService reports bootstrap failures in the created thread", async () => {
  const notices: string[] = [];
  const permanentFailures: unknown[] = [];
  const thread = createThread();
  const service = new AdminOverrideBootstrapService(
    {
      async routeMessage() {
        throw new Error("app server unavailable");
      }
    } as never,
    {
      async dispatchHarnessResponseToChannel() {
        throw new Error("dispatch should not be called");
      },
      async notifySanctionStateChange() {},
      async sendChunksToChannel(_thread: unknown, content: string) {
        notices.push(content);
      },
      async notifyPermanentFailure(input: unknown) {
        permanentFailures.push(input);
      }
    } as never,
    {
      classify() {
        return {
          retryable: true,
          publicCategory: "ai_processing_failed",
          adminErrorPayload: "app server unavailable",
          delayMs: 300000,
          terminalReason: null
        };
      }
    } as never,
    {
      async checkSoftBlock() {
        return {
          blocked: false,
          notice_text: null
        };
      }
    },
    {} as never,
    {
      warn() {}
    }
  );

  await service.bootstrapPrompt({
    thread,
    watchLocation: {
      guildId: "guild-1",
      channelId: "admin-root-1",
      mode: "admin_control",
      defaultScope: "server_public"
    },
    actorId: "admin-1",
    actorRole: "admin",
    prompt: "失敗させる",
    requestId: "override-bootstrap:2"
  });

  assert.equal(notices.length, 1);
  assert.match(notices[0] ?? "", /必要ならもう一度実行してください/);
  assert.equal(permanentFailures.length, 1);
});

function createThread() {
  const thread = {
    id: "thread-1",
    guildId: "guild-1",
    parentId: "admin-root-1",
    type: 11,
    isThread() {
      return true;
    },
    sent: [] as string[],
    async send(input: { content: string }) {
      this.sent.push(input.content);
    }
  };

  return thread as unknown as AnyThreadChannel & { sent: string[] };
}
