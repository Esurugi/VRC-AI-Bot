import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeKnowledgeIngestResponse,
  resolveKnowledgePersistenceScope
} from "../../src/harness/harness-runner.js";
import type { HarnessResponse } from "../../src/harness/contracts.js";
import type { HarnessMessageContext } from "../../src/harness/harness-runner.js";

test("knowledge thread follow-up knowledge ingest is coerced to chat reply", () => {
  const input = {
    envelope: {
      guildId: "guild-1",
      channelId: "thread-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "これも保存して https://example.com/update",
      urls: ["https://example.com/update"],
      receivedAt: "2026-04-13T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "root-1",
      mode: "url_watch",
      defaultScope: "server_public"
    },
    actorRole: "user",
    scope: "server_public"
  } satisfies HarnessMessageContext;

  const response = {
    outcome: "knowledge_ingest",
    repo_write_intent: false,
    public_text: null,
    reply_mode: "create_public_thread",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: ["https://example.com/update"],
    knowledge_writes: [
      {
        source_url: "https://example.com/update",
        canonical_url: "https://example.com/update",
        title: "Update",
        summary: "新しい要点",
        tags: ["update"],
        content_hash: null,
        normalized_text: null,
        source_kind: "webpage"
      }
    ],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none"
  } satisfies HarnessResponse;

  const normalized = normalizeKnowledgeIngestResponse(
    input,
    {
      kind: "knowledge_thread",
      sourceMessageId: "message-0",
      knownSourceUrls: ["https://example.com/original"],
      replyThreadId: "thread-1",
      rootChannelId: "root-1",
      knowledgeEntries: []
    },
    response,
    {
      fetchablePublicUrlCount: 1
    }
  );

  assert.equal(normalized.outcome, "chat_reply");
  assert.equal(normalized.reply_mode, "same_place");
  assert.equal(normalized.target_thread_id, null);
  assert.equal(normalized.public_text, null);
  assert.deepEqual(normalized.knowledge_writes, []);

  assert.equal(
    resolveKnowledgePersistenceScope(
      "server_public",
      input.watchLocation,
      {
        kind: "knowledge_thread",
        sourceMessageId: "message-0",
        knownSourceUrls: ["https://example.com/original"],
        replyThreadId: "thread-1",
        rootChannelId: "root-1",
        knowledgeEntries: []
      },
      normalized,
      1
    ),
    null
  );
});

test("root knowledge ingest can persist explicit save requests without pasted urls", () => {
  const input = {
    envelope: {
      guildId: "guild-1",
      channelId: "knowledge-root-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "このテーマを調べて知見として保存して",
      urls: [],
      receivedAt: "2026-04-13T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "knowledge-root-1",
      mode: "chat",
      defaultScope: "server_public",
      features: ["knowledge_ingest", "conversation"]
    },
    actorRole: "user",
    scope: "server_public"
  } satisfies HarnessMessageContext;

  const response = {
    outcome: "knowledge_ingest",
    repo_write_intent: false,
    public_text: "保存しました。",
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: ["https://example.com/researched"],
    knowledge_writes: [
      {
        source_url: "https://example.com/researched",
        canonical_url: "https://example.com/researched",
        title: "調査済み知見",
        summary: "公開調査に基づく要点",
        tags: ["research"],
        content_hash: null,
        normalized_text: "公開調査に基づく要点",
        source_kind: "webpage"
      }
    ],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none"
  } satisfies HarnessResponse;

  const normalized = normalizeKnowledgeIngestResponse(
    input,
    {
      kind: "root_channel",
      sourceMessageId: null,
      knownSourceUrls: [],
      replyThreadId: null,
      rootChannelId: "knowledge-root-1",
      knowledgeEntries: []
    },
    response,
    {
      fetchablePublicUrlCount: 0
    }
  );

  assert.equal(normalized.reply_mode, "same_place");
  assert.equal(
    resolveKnowledgePersistenceScope(
      "server_public",
      input.watchLocation,
      {
        kind: "root_channel",
        sourceMessageId: null,
        knownSourceUrls: [],
        replyThreadId: null,
        rootChannelId: "knowledge-root-1",
        knowledgeEntries: []
      },
      normalized,
      0
    ),
    "server_public"
  );
});
