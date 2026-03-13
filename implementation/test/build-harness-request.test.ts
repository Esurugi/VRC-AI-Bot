import assert from "node:assert/strict";
import test from "node:test";

import { buildHarnessRequest } from "../src/harness/build-harness-request.js";

test("buildHarnessRequest defaults to answer phase and facts-only available_context", () => {
  const request = buildHarnessRequest({
    actorRole: "user",
    scope: "channel_family",
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "chat",
      defaultScope: "channel_family"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "こんにちは",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    taskKind: "route_message"
  });

  assert.equal(request.task.phase, "answer");
  assert.equal(request.task.retry_context, null);
  assert.equal(request.available_context.thread_context.kind, "root_channel");
  assert.equal(request.available_context.discord_runtime_facts_path, null);
  assert.deepEqual(request.available_context.fetchable_public_urls, []);
  assert.deepEqual(request.available_context.blocked_urls, []);
});

test("buildHarnessRequest includes knowledge thread facts and URL fetch boundary", () => {
  const request = buildHarnessRequest({
    actorRole: "admin",
    scope: "server_public",
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "url_watch",
      defaultScope: "server_public"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "thread-1",
      messageId: "message-2",
      authorId: "user-2",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "もっと詳しく https://example.com https://localhost/test",
      urls: ["https://example.com", "https://localhost/test"],
      receivedAt: "2026-03-10T00:00:01.000Z"
    },
    taskKind: "route_message",
    taskPhase: "intent",
    threadContext: {
      kind: "knowledge_thread",
      sourceMessageId: "source-1",
      knownSourceUrls: ["https://openai.com/index/harness-engineering/"],
      replyThreadId: "thread-1",
      rootChannelId: "channel-1"
    },
    allowExternalFetch: false,
    allowKnowledgeWrite: false,
    discordRuntimeFactsPath: ".tmp/discord-runtime/message-2.json"
  });

  assert.equal(request.task.phase, "intent");
  assert.equal(request.place.thread_id, "thread-1");
  assert.deepEqual(request.available_context.thread_context, {
    kind: "knowledge_thread",
    source_message_id: "source-1",
    known_source_urls: ["https://openai.com/index/harness-engineering/"],
    reply_thread_id: "thread-1",
    root_channel_id: "channel-1"
  });
  assert.equal(
    request.available_context.discord_runtime_facts_path,
    ".tmp/discord-runtime/message-2.json"
  );
  assert.deepEqual(request.available_context.fetchable_public_urls, [
    "https://example.com"
  ]);
  assert.deepEqual(request.available_context.blocked_urls, [
    "https://localhost/test"
  ]);
});

test("buildHarnessRequest includes override context flags and capabilities", () => {
  const request = buildHarnessRequest({
    actorRole: "admin",
    scope: "conversation_only",
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "admin_control",
      defaultScope: "server_public"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "thread-1",
      messageId: "message-3",
      authorId: "admin-1",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "この thread の capability は？",
      urls: [],
      receivedAt: "2026-03-10T00:00:03.000Z"
    },
    taskKind: "route_message",
    allowExternalFetch: true,
    allowKnowledgeWrite: true,
    allowModeration: true,
    overrideContext: {
      active: true,
      sameActor: true,
      startedBy: "admin-1",
      startedAt: "2026-03-10T00:00:00.000Z",
      flags: {
        allowPlaywrightHeaded: true,
        allowPlaywrightPersistent: false,
        allowPromptInjectionTest: true,
        suspendViolationCounterForCurrentThread: false,
        allowExternalFetchInPrivateContextWithoutPrivateTerms: false
      }
    }
  });

  assert.deepEqual(request.capabilities, {
    allow_external_fetch: true,
    allow_knowledge_write: true,
    allow_moderation: true
  });
  assert.deepEqual(request.override_context, {
    active: true,
    same_actor: true,
    started_by: "admin-1",
    started_at: "2026-03-10T00:00:00.000Z",
    flags: {
      allow_playwright_headed: true,
      allow_playwright_persistent: false,
      allow_prompt_injection_test: true,
      suspend_violation_counter_for_current_thread: false,
      allow_external_fetch_in_private_context_without_private_terms: false
    }
  });
});

test("buildHarnessRequest encodes retry_context in task control plane", () => {
  const outputSafetyRequest = buildHarnessRequest({
    actorRole: "user",
    scope: "channel_family",
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "chat",
      defaultScope: "channel_family"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-5",
      authorId: "user-1",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "公開可能な根拠だけで答えて",
      urls: [],
      receivedAt: "2026-03-10T00:00:04.000Z"
    },
    taskKind: "route_message",
    taskPhase: "retry",
    retryContext: {
      kind: "output_safety",
      retryCount: 1,
      reason: "source url is not visible in current scope",
      allowedSources: ["https://openai.com/index/harness-engineering/"],
      disallowedSources: ["https://localhost/test"]
    }
  });

  assert.deepEqual(outputSafetyRequest.task.retry_context, {
    kind: "output_safety",
    retry_count: 1,
    reason: "source url is not visible in current scope",
    allowed_sources: ["https://openai.com/index/harness-engineering/"],
    disallowed_sources: ["https://localhost/test"]
  });

  const knowledgeRetryRequest = buildHarnessRequest({
    actorRole: "user",
    scope: "conversation_only",
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "chat",
      defaultScope: "channel_family"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "thread-1",
      messageId: "message-6",
      authorId: "user-1",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "日本語にして",
      urls: [],
      receivedAt: "2026-03-10T00:00:05.000Z"
    },
    taskKind: "route_message",
    taskPhase: "retry",
    retryContext: {
      kind: "knowledge_followup_non_silent",
      retryCount: 1
    }
  });

  assert.deepEqual(knowledgeRetryRequest.task.retry_context, {
    kind: "knowledge_followup_non_silent",
    retry_count: 1
  });
});
