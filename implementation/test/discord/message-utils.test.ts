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
