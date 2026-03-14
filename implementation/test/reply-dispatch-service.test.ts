import assert from "node:assert/strict";
import test from "node:test";

import {
  ReplyDispatchService,
  buildReferenceReply,
  extractReferenceUrls
} from "../src/runtime/message/reply-dispatch-service.js";
import type { HarnessResolvedSession } from "../src/harness/harness-runner.js";
import type { QueuedMessage } from "../src/runtime/types.js";

test("extractReferenceUrls keeps public URLs in citation order and drops non-public markers", () => {
  assert.deepEqual(
    extractReferenceUrls([
      "src-public",
      "https://example.com/a",
      "file:///tmp/private.txt",
      "https://example.com/b#section",
      "https://example.com/a"
    ]),
    ["https://example.com/a", "https://example.com/b"]
  );
});

test("buildReferenceReply formats forum references as numbered lines", () => {
  assert.equal(
    buildReferenceReply([
      "https://example.com/a",
      "https://example.com/b"
    ]),
    "[1]: https://example.com/a\n[2]: https://example.com/b"
  );
});

test("ReplyDispatchService sends forum references as a separate follow-up message", async () => {
  const sentReplies: string[] = [];
  const sentFollowups: string[] = [];
  const service = new ReplyDispatchService({
    store: {} as never,
    harnessRunner: {} as never,
    sessionManager: {} as never,
    sessionPolicyResolver: {} as never,
    watchLocations: [],
    logger: {
      debug() {},
      warn() {}
    },
    fetchChannel: async () => null
  });

  const item = {
    messageId: "message-1",
    orderingKey: "message-1",
    source: "live",
    message: {
      channelId: "thread-1",
      reply: async ({ content }: { content: string }) => {
        sentReplies.push(content);
      },
      channel: {
        id: "thread-1",
        isThread: () => true,
        send: async ({ content }: { content: string }) => {
          sentFollowups.push(content);
        }
      }
    },
    envelope: {
      guildId: "guild-1",
      channelId: "thread-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "forum_post_thread",
      rawPlaceType: "PublicThread",
      content: "論じて",
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
  } as unknown as QueuedMessage;

  const session = {
    threadId: "codex-thread-1",
    startedFresh: false,
    identity: {
      sessionIdentity: "session-1",
      workloadKind: "forum_longform",
      modelProfile: "forum:gpt-5.4:high",
      runtimeContractVersion: "2026-03-13.session-policy.v2",
      bindingKind: "thread",
      bindingId: "thread-1",
      actorId: "-",
      sandboxMode: "read-only",
      lifecyclePolicy: "thread_lifetime"
    }
  } as HarnessResolvedSession;

  await service.dispatchHarnessResponse(
    item,
    {
      outcome: "chat_reply",
      repo_write_intent: false,
      public_text: "本編です。[1][2]",
      reply_mode: "same_place",
      target_thread_id: null,
      selected_source_ids: [],
      sources_used: [
        "https://example.com/a",
        "https://example.com/b"
      ],
      knowledge_writes: [],
      diagnostics: {
        notes: "forum response"
      },
      sensitivity_raise: "conversation_only"
    },
    session,
    null
  );

  assert.deepEqual(sentReplies, ["本編です。[1][2]"]);
  assert.deepEqual(sentFollowups, [
    "[1]: https://example.com/a\n[2]: https://example.com/b"
  ]);
});
