import test from "node:test";
import assert from "node:assert/strict";

import { Collection } from "discord.js";

import {
  buildRecentRoomEventFacts
} from "../../../src/runtime/chat/recent-chat-history-service.js";

test("recent chat history keeps recent bot turns in a minimal room-event shape", () => {
  const botUserId = "bot";
  const history = new Collection<string, never>([
    [
      "m3",
      createHistoryMessage({
        id: "m3",
        authorId: "user-3",
        authorDisplayName: "ebi",
        content: "おおーー",
        createdAt: "2026-03-15T13:19:00.000Z",
        replyToMessageId: "m2",
        replyToAuthorId: "user-2",
        replyToAuthorDisplayName: "余暇"
      })
    ],
    [
      "m2",
      createHistoryMessage({
        id: "m2",
        authorId: "user-2",
        authorDisplayName: "余暇",
        content: "GPT5.4 fast を使っています()",
        createdAt: "2026-03-15T13:18:00.000Z",
        mentionsBot: true
      })
    ],
    [
      "bot-1",
      createHistoryMessage({
        id: "bot-1",
        authorId: botUserId,
        authorDisplayName: "ティラピコ",
        content: "今のおすすめは…",
        createdAt: "2026-03-15T13:17:00.000Z"
      })
    ],
    [
      "m0",
      createHistoryMessage({
        id: "m0",
        authorId: "user-0",
        authorDisplayName: "uhima",
        content: "@ティラピコ いまオススメのLLMモデルは何？",
        createdAt: "2026-03-15T13:16:00.000Z",
        mentionsBot: true
      })
    ]
  ]);

  const roomEvents = buildRecentRoomEventFacts(history, botUserId);

  assert.deepEqual(roomEvents, [
    {
      message_id: "m0",
      author: "uhima",
      is_bot: false,
      reply_to_message_id: null,
      mentions_bot: true,
      content: "@ティラピコ いまオススメのLLMモデルは何？"
    },
    {
      message_id: "bot-1",
      author: "ティラピコ",
      is_bot: true,
      reply_to_message_id: null,
      mentions_bot: false,
      content: "今のおすすめは…"
    },
    {
      message_id: "m2",
      author: "余暇",
      is_bot: false,
      reply_to_message_id: null,
      mentions_bot: true,
      content: "GPT5.4 fast を使っています()"
    },
    {
      message_id: "m3",
      author: "ebi",
      is_bot: false,
      reply_to_message_id: "m2",
      mentions_bot: false,
      content: "おおーー"
    }
  ]);
});

function createHistoryMessage(input: {
  id: string;
  authorId: string;
  authorDisplayName: string;
  content: string;
  createdAt: string;
  mentionsBot?: boolean;
  replyToMessageId?: string;
  replyToAuthorId?: string;
  replyToAuthorDisplayName?: string;
}) {
  const repliedUser =
    input.replyToAuthorId && input.replyToAuthorDisplayName
      ? {
          id: input.replyToAuthorId,
          globalName: input.replyToAuthorDisplayName,
          username: input.replyToAuthorDisplayName
        }
      : null;

  return {
    id: input.id,
    author: {
      id: input.authorId,
      bot: false,
      globalName: input.authorDisplayName,
      username: input.authorDisplayName
    },
    member: {
      displayName: input.authorDisplayName
    },
    content: input.content,
    createdAt: new Date(input.createdAt),
    webhookId: null,
    system: false,
    reference: input.replyToMessageId
      ? {
          messageId: input.replyToMessageId
        }
      : null,
    mentions: {
      repliedUser,
      users: {
        has: (userId: string) => input.mentionsBot === true && userId === "bot"
      }
    },
    guild: {
      members: {
        cache: new Collection(
          repliedUser
            ? [[input.replyToAuthorId!, { displayName: input.replyToAuthorDisplayName! }]]
            : []
        )
      }
    },
    inGuild: () => true
  } as never;
}
