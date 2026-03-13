import assert from "node:assert/strict";
import test from "node:test";

import { MessageProcessingService } from "../src/runtime/message/message-processing-service.js";

test("MessageProcessingService sends codex-derived forum bootstrap notice before dispatch", async () => {
  const notices: string[] = [];
  let receivedBootstrap: unknown = null;
  const service = createService({
    replyDispatchService: {
      async sendFollowupInSamePlace(_item: unknown, content: string) {
        notices.push(content);
      }
    },
    forumFirstTurnPreprocessor: {
      async resolveEffectiveContentOverride() {
        return {
          preparedPrompt: "prepared prompt",
          progressNotice: "論点と前提を整理しながら考えています。少し待ってください。",
          wasPreprocessed: true
        };
      }
    }
  });
  service.resolveHarnessMessage = (async (_item: unknown, forumBootstrap: unknown) => {
    receivedBootstrap = forumBootstrap;
    return createRoutedMessage();
  }) as never;

  await service.process(createQueuedMessage("live") as never);

  assert.deepEqual(notices, [
    "論点と前提を整理しながら考えています。少し待ってください。"
  ]);
  assert.deepEqual(receivedBootstrap, {
    preparedPrompt: "prepared prompt",
    progressNotice: "論点と前提を整理しながら考えています。少し待ってください。",
    wasPreprocessed: true
  });
});

test("MessageProcessingService does not send forum bootstrap notice on retry jobs", async () => {
  const notices: string[] = [];
  const service = createService({
    replyDispatchService: {
      async sendFollowupInSamePlace(_item: unknown, content: string) {
        notices.push(content);
      }
    },
    forumFirstTurnPreprocessor: {
      async resolveEffectiveContentOverride() {
        return {
          preparedPrompt: "prepared prompt",
          progressNotice: "論点と前提を整理しながら考えています。少し待ってください。",
          wasPreprocessed: true
        };
      }
    }
  });
  service.resolveHarnessMessage = (async () => createRoutedMessage()) as never;

  await service.process(createQueuedMessage("retry") as never);

  assert.deepEqual(notices, []);
});

function createService(overrides: {
  forumFirstTurnPreprocessor?: {
    resolveEffectiveContentOverride: () => Promise<{
      preparedPrompt: string | null;
      progressNotice: string | null;
      wasPreprocessed: boolean;
    }>;
  };
  replyDispatchService?: {
    sendFollowupInSamePlace?: (item: unknown, content: string) => Promise<void>;
  };
} = {}) {
  return new MessageProcessingService(
    {} as never,
    {
      messageProcessing: {
        tryAcquire() {
          return {
            status: "acquired"
          };
        },
        markCompleted() {}
      },
      channelCursors: {
        upsert() {}
      },
      retryJobs: {
        get() {
          return null;
        }
      }
    } as never,
    {} as never,
    ({
      async resolveEffectiveContentOverride() {
        return {
          preparedPrompt: null,
          progressNotice: null,
          wasPreprocessed: false
        };
      },
      ...overrides.forumFirstTurnPreprocessor
    } as never),
    {
      async collect() {
        return [];
      }
    } as never,
    {
      classify() {
        return {
          retryable: false,
          publicCategory: "ai_processing_failed",
          delayMs: null
        };
      }
    } as never,
    {
      clear() {},
      schedule() {}
    } as never,
    {
      async checkSoftBlock() {
        return {
          blocked: false,
          notice_text: null
        };
      }
    } as never,
    {} as never,
    ({
      async sendFollowupInSamePlace() {},
      async dispatchResolvedMessage() {
        return {
          channelId: "forum-thread-1",
          threadId: "forum-thread-1"
        };
      },
      async notifySanctionStateChange() {},
      ...overrides.replyDispatchService
    } as never),
    {
      info() {},
      warn() {},
      error() {}
    } as never
  );
}

function createQueuedMessage(source: "live" | "retry") {
  return {
    messageId: "message-1",
    orderingKey: "forum-thread-1",
    source,
    message: {
      channelId: "forum-thread-1",
      channel: {
        id: "forum-thread-1",
        isThread() {
          return true;
        },
        async sendTyping() {}
      }
    },
    envelope: {
      guildId: "guild-1",
      channelId: "forum-thread-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "forum_post_thread",
      rawPlaceType: "PublicThread",
      content: "相談本文",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "forum-parent-1",
      mode: "forum_longform",
      defaultScope: "conversation_only"
    },
    actorRole: "user",
    scope: "conversation_only"
  };
}

function createRoutedMessage() {
  return {
    response: {
      outcome: "chat_reply" as const,
      repo_write_intent: false,
      public_text: "回答です。",
      reply_mode: "same_place" as const,
      target_thread_id: null,
      selected_source_ids: [],
      sources_used: [],
      knowledge_writes: [],
      diagnostics: {
        notes: null
      },
      sensitivity_raise: "none" as const
    },
    session: {
      identity: {
        sessionIdentity: "session-1",
        workloadKind: "forum_longform",
        actorId: "user-1",
        scopeKey: "forum-thread-1",
        sandboxMode: "read-only",
        modelProfile: "forum:gpt-5.4:high",
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
