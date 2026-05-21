import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMessageEnvelope,
  isEligibleMessage
} from "../../src/discord/message-utils.js";

test("eligible message accepts plain-text attachments even without inline text", () => {
  assert.equal(
    isEligibleMessage(
      createMessage({
        content: "",
        attachments: [
          {
            id: "a1",
            name: "notes.txt",
            contentType: "text/plain",
            size: 128,
            url: "https://cdn.example.com/notes.txt"
          }
        ]
      }) as never
    ),
    true
  );
});

test("message envelope uses effective content override for text attachments", () => {
  const envelope = buildMessageEnvelope(
    createMessage({
      content: "",
      attachments: []
    }) as never,
    {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    },
    "質問本文\n\nAttached text file (notes.txt):\nhttps://example.com/article"
  );

  assert.equal(envelope.content, "質問本文\n\nAttached text file (notes.txt):\nhttps://example.com/article");
  assert.deepEqual(envelope.urls, ["https://example.com/article"]);
});

test("message envelope resolves admin override place from features", () => {
  const envelope = buildMessageEnvelope(
    createMessage({
      content: "状態を見て",
      attachments: []
    }) as never,
    {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      features: ["admin_override", "conversation"],
      defaultScope: "conversation_only",
      chatBehavior: "directed_help_chat"
    }
  );

  assert.equal(envelope.placeType, "admin_control_channel");
});

test("message envelope resolves forum thread place from features", () => {
  const envelope = buildMessageEnvelope(
    {
      ...createMessage({
        content: "高度な質問",
        attachments: []
      }),
      channelId: "thread",
      channel: {
        type: 11,
        isThread: () => true
      }
    } as never,
    {
      guildId: "guild",
      channelId: "forum-root",
      mode: "chat",
      features: ["forum_research", "conversation"],
      defaultScope: "server_public",
      chatBehavior: null
    }
  );

  assert.equal(envelope.placeType, "forum_post_thread");
});

test("message envelope resolves conversation channel place from features", () => {
  const envelope = buildMessageEnvelope(
    createMessage({
      content: "雑談です",
      attachments: []
    }) as never,
    {
      guildId: "guild",
      channelId: "channel",
      mode: "url_watch",
      features: ["conversation"],
      defaultScope: "conversation_only",
      chatBehavior: "ambient_room_chat"
    }
  );

  assert.equal(envelope.placeType, "chat_channel");
});

test("message envelope does not treat knowledge ingest feature as chat place", () => {
  const envelope = buildMessageEnvelope(
    createMessage({
      content: "https://example.com",
      attachments: []
    }) as never,
    {
      guildId: "guild",
      channelId: "channel",
      mode: "chat",
      features: ["knowledge_ingest", "conversation"],
      defaultScope: "server_public",
      chatBehavior: null
    }
  );

  assert.equal(envelope.placeType, "guild_text");
});

function createMessage(input: {
  content: string;
  attachments: Array<{
    id: string;
    name: string;
    contentType: string | null;
    size: number;
    url: string;
  }>;
}) {
  return {
    author: {
      bot: false
    },
    webhookId: null,
    content: input.content,
    attachments: new Map(
      input.attachments.map((attachment) => [
        attachment.id,
        {
          ...attachment
        }
      ])
    ),
    inGuild: () => true,
    guildId: "guild",
    channelId: "channel",
    id: "message",
    createdAt: new Date("2026-04-13T00:00:00.000Z"),
    channel: {
      type: 0,
      isThread: () => false
    }
  };
}
