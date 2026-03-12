import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CODEX_MODEL_PROFILE,
  RUNTIME_CONTRACT_VERSION,
  SessionPolicyResolver,
  buildMessageOriginBindingId,
  buildPlaceBindingId
} from "../src/codex/session-policy.js";

test("SessionPolicyResolver resolves root chat to reusable place conversation identity", () => {
  const resolver = new SessionPolicyResolver();
  const resolved = resolver.resolveForMessage({
    envelope: {
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "こんにちは",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "chat",
      defaultScope: "channel_family"
    },
    actorRole: "user",
    scope: "channel_family",
    workspaceWriteActive: false
  });

  assert.deepEqual(resolved, {
    sessionIdentity:
      "workload=conversation|binding_kind=place|binding_id=channel-1:chat|actor_id=-|sandbox=read-only|model=default:gpt-5.4|contract=2026-03-12.session-policy.v1|lifecycle=reusable",
    workloadKind: "conversation",
    bindingKind: "place",
    bindingId: buildPlaceBindingId("channel-1", "chat"),
    actorId: null,
    sandboxMode: "read-only",
    modelProfile: DEFAULT_CODEX_MODEL_PROFILE,
    runtimeContractVersion: RUNTIME_CONTRACT_VERSION,
    lifecyclePolicy: "reusable"
  });
});

test("SessionPolicyResolver resolves url_watch root URL share to knowledge_ingest message origin identity", () => {
  const resolver = new SessionPolicyResolver();
  const resolved = resolver.resolveForMessage({
    envelope: {
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-9",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "https://example.com",
      urls: ["https://example.com"],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "url_watch",
      defaultScope: "server_public"
    },
    actorRole: "user",
    scope: "server_public",
    workspaceWriteActive: false
  });

  assert.equal(resolved.workloadKind, "knowledge_ingest");
  assert.equal(resolved.bindingKind, "message_origin");
  assert.equal(
    resolved.bindingId,
    buildMessageOriginBindingId("channel-1", "message-9")
  );
  assert.equal(resolved.sandboxMode, "read-only");
});

test("SessionPolicyResolver resolves thread follow-up to reusable conversation thread identity", () => {
  const resolver = new SessionPolicyResolver();
  const resolved = resolver.resolveForMessage({
    envelope: {
      guildId: "guild-1",
      channelId: "thread-1",
      messageId: "message-2",
      authorId: "user-1",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "日本語にして",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "url_watch",
      defaultScope: "server_public"
    },
    actorRole: "user",
    scope: "server_public",
    workspaceWriteActive: false
  });

  assert.equal(resolved.workloadKind, "conversation");
  assert.equal(resolved.bindingKind, "thread");
  assert.equal(resolved.bindingId, "thread-1");
  assert.equal(resolved.lifecyclePolicy, "reusable");
});

test("SessionPolicyResolver resolves active override thread to explicit-close workspace-write identity", () => {
  const resolver = new SessionPolicyResolver();
  const resolved = resolver.resolveForMessage({
    envelope: {
      guildId: "guild-1",
      channelId: "thread-override-1",
      messageId: "message-3",
      authorId: "admin-1",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "今の権限は？",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "admin-root-1",
      mode: "admin_control",
      defaultScope: "server_public"
    },
    actorRole: "admin",
    scope: "conversation_only",
    workspaceWriteActive: true
  });

  assert.equal(resolved.workloadKind, "admin_override");
  assert.equal(resolved.bindingKind, "thread");
  assert.equal(resolved.bindingId, "thread-override-1");
  assert.equal(resolved.actorId, "admin-1");
  assert.equal(resolved.sandboxMode, "workspace-write");
  assert.equal(resolved.lifecyclePolicy, "explicit_close");
});
