import test from "node:test";
import assert from "node:assert/strict";

import { buildHarnessRequest } from "../../src/harness/build-harness-request.js";

test("buildHarnessRequest includes chat engagement facts and structured room context", () => {
  const request = buildHarnessRequest({
    actorRole: "user",
    scope: "conversation_only",
    watchLocation: {
      guildId: "guild",
      channelId: "root-channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "thread-or-channel",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "おおーー",
      urls: [],
      receivedAt: "2026-03-15T13:20:00.000Z"
    },
    taskKind: "route_message",
    chatEngagement: {
      trigger_kind: "sparse_periodic",
      is_directed_to_bot: false,
      sparse_ordinal: 5,
      ordinary_message_count: 5
    },
    recentRoomEvents: [
      {
        message_id: "bot-1",
        author: "ティラピコ",
        is_bot: true,
        reply_to_message_id: null,
        mentions_bot: false,
        content: "今のおすすめは…"
      }
    ]
  });

  assert.deepEqual(request.available_context.chat_engagement, {
    trigger_kind: "sparse_periodic",
    is_directed_to_bot: false,
    sparse_ordinal: 5,
    ordinary_message_count: 5
  });
  assert.equal("recent_messages" in request.available_context, false);
  assert.deepEqual(request.available_context.place_context, {
    features: ["conversation"],
    is_knowledge_place: false
  });
  assert.deepEqual(request.available_context.delivery_context, {
    is_bot_directed: false,
    bot_directed_trigger_kind: null
  });
  assert.equal(request.available_context.chat_behavior, "ambient_room_chat");
  assert.deepEqual(request.available_context.recent_room_events, [
    {
      message_id: "bot-1",
      author: "ティラピコ",
      is_bot: true,
      reply_to_message_id: null,
      mentions_bot: false,
      content: "今のおすすめは…"
    }
  ]);
});

test("buildHarnessRequest marks knowledge places and explicit bot-directed delivery", () => {
  const request = buildHarnessRequest({
    actorRole: "user",
    scope: "server_public",
    watchLocation: {
      guildId: "guild",
      channelId: "knowledge-root",
      mode: "url_watch",
      defaultScope: "server_public"
    },
    envelope: {
      guildId: "guild",
      channelId: "knowledge-root",
      messageId: "message-2",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "<@bot> これを知見として整理して https://example.com/post",
      urls: ["https://example.com/post"],
      receivedAt: "2026-03-15T13:20:00.000Z"
    },
    taskKind: "route_message",
    chatEngagement: {
      trigger_kind: "direct_mention",
      is_directed_to_bot: true,
      sparse_ordinal: null,
      ordinary_message_count: null
    }
  });

  assert.deepEqual(request.available_context.place_context, {
    features: ["knowledge_ingest", "conversation"],
    is_knowledge_place: true
  });
  assert.deepEqual(request.available_context.delivery_context, {
    is_bot_directed: true,
    bot_directed_trigger_kind: "direct_mention"
  });
});

test("buildHarnessRequest exposes configured place features independently from mode", () => {
  const request = buildHarnessRequest({
    actorRole: "admin",
    scope: "conversation_only",
    watchLocation: {
      guildId: "guild",
      channelId: "ops-root",
      mode: "chat",
      features: ["admin_override", "conversation"],
      defaultScope: "conversation_only",
      chatBehavior: "directed_help_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "ops-root",
      messageId: "message-3",
      authorId: "admin-1",
      placeType: "admin_control_channel",
      rawPlaceType: "GuildText",
      content: "状態を診断して",
      urls: [],
      receivedAt: "2026-03-15T13:20:00.000Z"
    },
    taskKind: "route_message"
  });

  assert.deepEqual(request.available_context.place_context.features, [
    "admin_override",
    "conversation"
  ]);
  assert.equal(request.place.mode, "chat");
});

test("buildHarnessRequest derives chat behavior from configured conversation profile, not legacy mode alone", () => {
  const directedRequest = buildHarnessRequest({
    actorRole: "user",
    scope: "conversation_only",
    watchLocation: {
      guildId: "guild",
      channelId: "help-root",
      mode: "chat",
      features: ["conversation"],
      defaultScope: "conversation_only",
      chatBehavior: "directed_help_chat"
    },
    envelope: {
      guildId: "guild",
      channelId: "help-root",
      messageId: "message-4",
      authorId: "user-1",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "<@bot> 手伝って",
      urls: [],
      receivedAt: "2026-05-21T00:00:00.000Z"
    },
    taskKind: "route_message"
  });
  assert.equal(directedRequest.available_context.chat_behavior, "directed_help_chat");

  const knowledgeRequest = buildHarnessRequest({
    actorRole: "user",
    scope: "server_public",
    watchLocation: {
      guildId: "guild",
      channelId: "knowledge-root",
      mode: "chat",
      features: ["knowledge_ingest", "conversation"],
      defaultScope: "server_public"
    },
    envelope: {
      guildId: "guild",
      channelId: "knowledge-root",
      messageId: "message-5",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "知見化して https://example.com/post",
      urls: ["https://example.com/post"],
      receivedAt: "2026-05-21T00:00:00.000Z"
    },
    taskKind: "route_message"
  });
  assert.equal(knowledgeRequest.available_context.chat_behavior, null);
});

test("buildHarnessRequest admits X status URLs into typed public evidence resources", () => {
  const request = buildHarnessRequest({
    actorRole: "user",
    scope: "server_public",
    watchLocation: {
      guildId: "guild",
      channelId: "knowledge-root",
      mode: "url_watch",
      defaultScope: "server_public",
      features: ["knowledge_ingest", "conversation"]
    },
    envelope: {
      guildId: "guild",
      channelId: "knowledge-root",
      messageId: "message-x",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "https://x.com/am921543266/status/2068900130397569096?s=46",
      urls: ["https://x.com/am921543266/status/2068900130397569096?s=46"],
      receivedAt: "2026-06-22T00:00:00.000Z"
    },
    taskKind: "route_message"
  });

  const availableContext = request.available_context as any;
  assert.equal("fetchable_public_urls" in availableContext, false);
  assert.equal("public_fetch_candidates" in availableContext, false);
  assert.deepEqual(availableContext.approved_public_urls, [
    {
      original_url: "https://x.com/am921543266/status/2068900130397569096?s=46",
      canonical_url: "https://x.com/am921543266/status/2068900130397569096?s=46"
    }
  ]);
  assert.deepEqual(availableContext.public_source_resources, [
    {
      resource_id: "x-status:2068900130397569096",
      provider: "x_status",
      original_url: "https://x.com/am921543266/status/2068900130397569096?s=46",
      canonical_item_url: "https://x.com/am921543266/status/2068900130397569096"
    }
  ]);
  assert.deepEqual(availableContext.readable_public_url_candidates, [
    {
      candidate_id: "x-status:2068900130397569096:fxtwitter",
      resource_id: "x-status:2068900130397569096",
      provider: "x_twitter_fxtwitter",
      original_url: "https://x.com/am921543266/status/2068900130397569096?s=46",
      canonical_item_url: "https://x.com/am921543266/status/2068900130397569096",
      retrieval_url: "https://api.fxtwitter.com/2/status/2068900130397569096"
    },
    {
      candidate_id: "x-status:2068900130397569096:jina",
      resource_id: "x-status:2068900130397569096",
      provider: "x_twitter_jina",
      original_url: "https://x.com/am921543266/status/2068900130397569096?s=46",
      canonical_item_url: "https://x.com/am921543266/status/2068900130397569096",
      retrieval_url:
        "https://r.jina.ai/https://x.com/am921543266/status/2068900130397569096"
    }
  ]);
  assert.deepEqual(availableContext.public_source_facts, []);
  assert.deepEqual(availableContext.public_source_failures, []);
});

test("buildHarnessRequest normalizes X status mirror domains to x_status resources", () => {
  for (const originalUrl of [
    "https://fxtwitter.com/OpenAIDevs/status/2033636701848174967",
    "https://fixupx.com/OpenAIDevs/status/2033636701848174967",
    "https://vxtwitter.com/OpenAIDevs/status/2033636701848174967",
    "https://twitter.com/OpenAIDevs/status/2033636701848174967"
  ]) {
    const request = buildHarnessRequest({
      actorRole: "user",
      scope: "server_public",
      watchLocation: {
        guildId: "guild",
        channelId: "knowledge-root",
        mode: "url_watch",
        defaultScope: "server_public",
        features: ["knowledge_ingest", "conversation"]
      },
      envelope: {
        guildId: "guild",
        channelId: "knowledge-root",
        messageId: `message-${new URL(originalUrl).hostname}`,
        authorId: "user-1",
        placeType: "guild_text",
        rawPlaceType: "GuildText",
        content: originalUrl,
        urls: [originalUrl],
        receivedAt: "2026-06-22T00:00:00.000Z"
      },
      taskKind: "route_message"
    });

    const availableContext = request.available_context as any;
    assert.equal("fetchable_public_urls" in availableContext, false);
    assert.equal("public_fetch_candidates" in availableContext, false);
    assert.deepEqual(availableContext.public_source_resources, [
      {
        resource_id: "x-status:2033636701848174967",
        provider: "x_status",
        original_url: originalUrl,
        canonical_item_url:
          "https://x.com/OpenAIDevs/status/2033636701848174967"
      }
    ]);
    assert.deepEqual(
      availableContext.readable_public_url_candidates.map(
        (candidate: { provider: string; retrieval_url: string }) => [
          candidate.provider,
          candidate.retrieval_url
        ]
      ),
      [
        [
          "x_twitter_fxtwitter",
          "https://api.fxtwitter.com/2/status/2033636701848174967"
        ],
        [
          "x_twitter_jina",
          "https://r.jina.ai/https://x.com/OpenAIDevs/status/2033636701848174967"
        ]
      ]
    );
  }
});

test("buildHarnessRequest normalizes i/web X status URLs to query-free x.com canonical items", () => {
  const request = buildHarnessRequest({
    actorRole: "user",
    scope: "server_public",
    watchLocation: {
      guildId: "guild",
      channelId: "knowledge-root",
      mode: "url_watch",
      defaultScope: "server_public",
      features: ["knowledge_ingest", "conversation"]
    },
    envelope: {
      guildId: "guild",
      channelId: "knowledge-root",
      messageId: "message-x-web",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "https://x.com/i/web/status/2033636701848174967",
      urls: ["https://x.com/i/web/status/2033636701848174967"],
      receivedAt: "2026-06-22T00:00:00.000Z"
    },
    taskKind: "route_message"
  });

  const availableContext = request.available_context as any;
  assert.equal("fetchable_public_urls" in availableContext, false);
  assert.equal("public_fetch_candidates" in availableContext, false);
  assert.deepEqual(availableContext.approved_public_urls, [
    {
      original_url: "https://x.com/i/web/status/2033636701848174967",
      canonical_url: "https://x.com/i/web/status/2033636701848174967"
    }
  ]);
  assert.deepEqual(availableContext.readable_public_url_candidates, [
    {
      candidate_id: "x-status:2033636701848174967:fxtwitter",
      resource_id: "x-status:2033636701848174967",
      provider: "x_twitter_fxtwitter",
      original_url: "https://x.com/i/web/status/2033636701848174967",
      canonical_item_url: "https://x.com/i/web/status/2033636701848174967",
      retrieval_url: "https://api.fxtwitter.com/2/status/2033636701848174967"
    },
    {
      candidate_id: "x-status:2033636701848174967:jina",
      resource_id: "x-status:2033636701848174967",
      provider: "x_twitter_jina",
      original_url: "https://x.com/i/web/status/2033636701848174967",
      canonical_item_url: "https://x.com/i/web/status/2033636701848174967",
      retrieval_url:
        "https://r.jina.ai/https://x.com/i/web/status/2033636701848174967"
    }
  ]);
});

test("buildHarnessRequest does not create readable candidates from blocked or private URLs", () => {
  const request = buildHarnessRequest({
    actorRole: "user",
    scope: "server_public",
    watchLocation: {
      guildId: "guild",
      channelId: "knowledge-root",
      mode: "url_watch",
      defaultScope: "server_public",
      features: ["knowledge_ingest", "conversation"]
    },
    envelope: {
      guildId: "guild",
      channelId: "knowledge-root",
      messageId: "message-private",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content:
        "http://127.0.0.1/status/2033636701848174967 file:///tmp/source https://example.local/source",
      urls: [
        "http://127.0.0.1/status/2033636701848174967",
        "file:///tmp/source",
        "https://example.local/source"
      ],
      receivedAt: "2026-06-22T00:00:00.000Z"
    },
    taskKind: "route_message"
  });

  const availableContext = request.available_context as any;
  assert.deepEqual(availableContext.approved_public_urls, []);
  assert.deepEqual(availableContext.public_source_resources, []);
  assert.deepEqual(availableContext.readable_public_url_candidates, []);
  assert.deepEqual(availableContext.public_source_facts, []);
  assert.deepEqual(availableContext.public_source_failures, []);
  assert.deepEqual(availableContext.blocked_urls, [
    "http://127.0.0.1/status/2033636701848174967",
    "file:///tmp/source",
    "https://example.local/source"
  ]);
});
