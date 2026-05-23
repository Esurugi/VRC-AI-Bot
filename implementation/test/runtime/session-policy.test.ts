import test from "node:test";
import assert from "node:assert/strict";

import {
  CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE,
  CLEAR_EXPLANATION_CODEX_MODEL_PROFILE,
  DEFAULT_CODEX_MODEL_PROFILE,
  FORUM_LONGFORM_CODEX_MODEL_PROFILE,
  SessionPolicyResolver,
  resolveScopedPlaceId
} from "../../src/codex/session-policy.js";

test("url watch root share resolves to knowledge ingest with message origin binding", () => {
  const resolver = new SessionPolicyResolver();
  const session = resolver.resolveForMessage({
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "https://example.com/post",
      urls: ["https://example.com/post"],
      receivedAt: new Date().toISOString()
    },
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "server_public",
      chatBehavior: null
    },
    actorRole: "user",
    scope: "server_public",
    workspaceWriteActive: false
  });

  assert.equal(session.workloadKind, "knowledge_ingest");
  assert.equal(session.bindingKind, "message_origin");
  assert.equal(session.bindingId, "channel:message:message");
  assert.equal(session.modelProfile, DEFAULT_CODEX_MODEL_PROFILE);
});

test("url watch root without evidence stays in conversation scope", () => {
  const resolver = new SessionPolicyResolver();
  const session = resolver.resolveForMessage({
    envelope: {
      guildId: "guild",
      channelId: "channel",
      messageId: "message",
      authorId: "user",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "こんにちは",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "server_public",
      chatBehavior: null
    },
    actorRole: "user",
    scope: "server_public",
    workspaceWriteActive: false
  });

  assert.equal(session.workloadKind, "conversation");
  assert.equal(session.bindingKind, "place");
  assert.equal(session.bindingId, "channel");
  assert.equal(session.modelProfile, CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE);
});

test("forum research feature resolves to forum thread session even when legacy mode says chat", () => {
  const resolver = new SessionPolicyResolver();
  const session = resolver.resolveForMessage({
    envelope: {
      guildId: "guild",
      channelId: "forum-thread",
      messageId: "message",
      authorId: "user",
      placeType: "forum_post_thread",
      rawPlaceType: "PublicThread",
      content: "詳しく調べて",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    watchLocation: {
      guildId: "guild",
      channelId: "forum-root",
      mode: "chat",
      features: ["forum_research", "conversation"],
      defaultScope: "server_public",
      chatBehavior: null
    },
    actorRole: "user",
    scope: "server_public",
    workspaceWriteActive: false
  });

  assert.equal(session.workloadKind, "forum_longform");
  assert.equal(session.bindingKind, "thread");
  assert.equal(session.bindingId, "forum-thread");
  assert.equal(session.modelProfile, FORUM_LONGFORM_CODEX_MODEL_PROFILE);
});

test("clear explanation feature resolves to thread-lifetime high reasoning session", () => {
  const resolver = new SessionPolicyResolver();
  const session = resolver.resolveForMessage({
    envelope: {
      guildId: "guild",
      channelId: "clear-thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "初心者向けに図で説明して",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    watchLocation: {
      guildId: "guild",
      channelId: "clear-root",
      mode: "chat",
      features: ["clear_explanation", "conversation"],
      defaultScope: "server_public",
      chatBehavior: null
    },
    actorRole: "user",
    scope: "server_public",
    workspaceWriteActive: false
  });

  assert.equal(session.workloadKind, "clear_explanation");
  assert.equal(session.bindingKind, "thread");
  assert.equal(session.bindingId, "clear-thread");
  assert.equal(session.lifecyclePolicy, "thread_lifetime");
  assert.equal(session.modelProfile, CLEAR_EXPLANATION_CODEX_MODEL_PROFILE);
});

test("knowledge ingest feature resolves to knowledge policy even when legacy mode says chat", () => {
  const resolver = new SessionPolicyResolver();
  const session = resolver.resolveForMessage({
    envelope: {
      guildId: "guild",
      channelId: "knowledge-root",
      messageId: "message",
      authorId: "user",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "知見化して https://example.com/post",
      urls: ["https://example.com/post"],
      receivedAt: new Date().toISOString()
    },
    watchLocation: {
      guildId: "guild",
      channelId: "knowledge-root",
      mode: "chat",
      features: ["knowledge_ingest", "conversation"],
      defaultScope: "server_public",
      chatBehavior: "directed_help_chat"
    },
    actorRole: "user",
    scope: "server_public",
    workspaceWriteActive: false
  });

  assert.equal(session.workloadKind, "knowledge_ingest");
  assert.equal(session.bindingKind, "message_origin");
  assert.equal(session.bindingId, "knowledge-root:message:message");
});

test("thread follow-up conversation uses the mini chat profile outside forum longform", () => {
  const resolver = new SessionPolicyResolver();
  const session = resolver.resolveForMessage({
    envelope: {
      guildId: "guild",
      channelId: "thread",
      messageId: "message",
      authorId: "user",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "追加で教えて",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    watchLocation: {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      defaultScope: "server_public",
      chatBehavior: null
    },
    actorRole: "user",
    scope: "server_public",
    workspaceWriteActive: false
  });

  assert.equal(session.workloadKind, "conversation");
  assert.equal(session.bindingKind, "thread");
  assert.equal(session.bindingId, "thread");
  assert.equal(session.modelProfile, CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE);
});

test("workspace-write active messages resolve to admin override thread session", () => {
  const resolver = new SessionPolicyResolver();
  const session = resolver.resolveForMessage({
    envelope: {
      guildId: "guild",
      channelId: "override-thread",
      messageId: "message",
      authorId: "admin",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "repo を直して",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    watchLocation: {
      guildId: "guild",
      channelId: "ops-root",
      mode: "chat",
      features: ["admin_override", "conversation"],
      defaultScope: "conversation_only",
      chatBehavior: "directed_help_chat"
    },
    actorRole: "admin",
    scope: "conversation_only",
    workspaceWriteActive: true
  });

  assert.equal(session.workloadKind, "admin_override");
  assert.equal(session.bindingKind, "thread");
  assert.equal(session.bindingId, "override-thread");
  assert.equal(session.actorId, "admin");
  assert.equal(session.sandboxMode, "workspace-write");
});

test("resolved scoped place id keeps knowledge roots on message origin", () => {
  assert.equal(
    resolveScopedPlaceId({
      envelope: {
        guildId: "guild",
        channelId: "channel",
        messageId: "message",
        authorId: "user",
        placeType: "guild_text",
        rawPlaceType: "GuildText",
        content: "https://example.com/post",
        urls: ["https://example.com/post"],
        receivedAt: new Date().toISOString()
      },
      watchLocation: {
        guildId: "guild",
        channelId: "channel",
        mode: "url_watch",
        defaultScope: "server_public",
        chatBehavior: null
      }
    }),
    "channel:message:message"
  );

  assert.equal(
    resolveScopedPlaceId({
      envelope: {
        guildId: "guild",
        channelId: "thread",
        messageId: "message",
        authorId: "user",
        placeType: "public_thread",
        rawPlaceType: "PublicThread",
        content: "",
        urls: [],
        receivedAt: new Date().toISOString()
      },
      watchLocation: {
        guildId: "guild",
        channelId: "channel",
        mode: "url_watch",
        defaultScope: "server_public",
        chatBehavior: null
      }
    }),
    "thread"
  );
});

test("resolved scoped place id excludes legacy mode from place binding", () => {
  assert.equal(
    resolveScopedPlaceId({
      envelope: {
        guildId: "guild",
        channelId: "channel",
        messageId: "message",
        authorId: "user",
        placeType: "chat_channel",
        rawPlaceType: "GuildText",
        content: "こんにちは",
        urls: [],
        receivedAt: new Date().toISOString()
      },
      watchLocation: {
        guildId: "guild",
        channelId: "channel",
        mode: "url_watch",
        defaultScope: "server_public",
        chatBehavior: null
      }
    }),
    "channel"
  );
});
