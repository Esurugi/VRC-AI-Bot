import assert from "node:assert/strict";
import test from "node:test";

import { MessageProcessingService } from "../src/runtime/message/message-processing-service.js";

test("MessageProcessingService passes forum starter facts into harness resolution", async () => {
  let receivedBootstrap: unknown = null;
  const service = createService({
    forumFirstTurnPreprocessor: {
      async resolveEffectiveContentOverride() {
        return {
          preparedPrompt: null,
          progressNotice: null,
          wasPreprocessed: false,
          starterMessage: "thread starter"
        };
      }
    }
  });
  service.resolveHarnessMessage = (async (_item: unknown, forumBootstrap: unknown) => {
    receivedBootstrap = forumBootstrap;
    return createRoutedMessage();
  }) as never;

  await service.process(createQueuedMessage("live") as never);

  assert.deepEqual(receivedBootstrap, {
    preparedPrompt: null,
    progressNotice: null,
    wasPreprocessed: false,
    starterMessage: "thread starter"
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
          wasPreprocessed: true,
          starterMessage: "thread starter"
        };
      }
    }
  });
  service.resolveHarnessMessage = (async () => createRoutedMessage()) as never;

  await service.process(createQueuedMessage("retry") as never);

  assert.deepEqual(notices, []);
});

test("MessageProcessingService closes forum retry-job failures without re-scheduling delayed retry", async () => {
  const notices: string[] = [];
  let scheduled = 0;
  let completedMessageId: string | null = null;
  const service = createService({
    store: {
      messageProcessing: {
        tryAcquire() {
          return {
            status: "acquired"
          };
        },
        markCompleted(messageId: string) {
          completedMessageId = messageId;
        }
      }
    },
    retryScheduler: {
      clear() {},
      schedule() {
        scheduled += 1;
      }
    },
    replyDispatchService: {
      async notifyFailureForRetryJob(_item: unknown, content: string) {
        notices.push(content);
      }
    }
  });

  await service.handleRetryJobFailure(
    {
      message_id: "message-1",
      guild_id: "guild-1",
      message_channel_id: "forum-thread-1",
      watch_channel_id: "forum-parent-1",
      attempt_count: 2,
      next_attempt_at: "2026-03-10T00:00:00.000Z",
      last_failure_category: "fetch_timeout",
      reply_channel_id: "forum-parent-1",
      reply_thread_id: "forum-thread-1",
      place_mode: "forum_longform",
      stage: "fetch_or_resolve",
      created_at: "2026-03-10T00:00:00.000Z",
      updated_at: "2026-03-10T00:00:00.000Z"
    } as never,
    new Error("request timed out")
  );

  assert.equal(scheduled, 0);
  assert.equal(completedMessageId, "message-1");
  assert.match(notices[0] ?? "", /visible retry は完了できなかった/);
});

test("MessageProcessingService streams final forum text to Discord instead of pulsing typing", async () => {
  const streamed: string[] = [];
  let completed = 0;
  const typingReasons: string[] = [];
  const service = createService({
    replyDispatchService: {
      async createStreamingReplyInSamePlace() {
        return {
          async append(delta: string) {
            streamed.push(delta);
          },
          async complete() {
            completed += 1;
          }
        };
      }
    }
  });

  const callbacks = (service as any).buildForumCallbacks(createQueuedMessage("live"), {
    pulseNow: async (reason: string) => {
      typingReasons.push(reason);
    },
    stop() {}
  });

  await callbacks.onFinalTextDelta("前半");
  await callbacks.onFinalTextDelta("後半");
  await callbacks.onFinalTextCompleted();

  assert.deepEqual(streamed, ["前半", "後半"]);
  assert.equal(completed, 1);
  assert.deepEqual(typingReasons, []);
});

function createService(overrides: {
  forumFirstTurnPreprocessor?: {
    resolveEffectiveContentOverride: () => Promise<{
      preparedPrompt: string | null;
      progressNotice: string | null;
      wasPreprocessed: boolean;
      starterMessage: string | null;
    }>;
  };
  replyDispatchService?: {
    sendFollowupInSamePlace?: (item: unknown, content: string) => Promise<void>;
    notifyFailureForRetryJob?: (item: unknown, content: string) => Promise<void>;
    createStreamingReplyInSamePlace?: (item: unknown) => Promise<{
      append: (delta: string) => Promise<void>;
      complete: () => Promise<void>;
    }>;
  };
  retryScheduler?: {
    clear?: (messageId: string) => void;
    schedule?: (...args: unknown[]) => void;
  };
  store?: {
    messageProcessing?: {
      tryAcquire?: () => { status: "acquired" };
      markCompleted?: (messageId: string) => void;
    };
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
        markCompleted() {},
        ...overrides.store?.messageProcessing
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
          wasPreprocessed: false,
          starterMessage: null
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
    ({
      clear() {},
      schedule() {},
      ...overrides.retryScheduler
    } as never),
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
      async notifyFailureForRetryJob() {},
      async createStreamingReplyInSamePlace() {
        return {
          async append() {},
          async complete() {}
        };
      },
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
