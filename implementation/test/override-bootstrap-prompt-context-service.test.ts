import assert from "node:assert/strict";
import test from "node:test";
import { Collection } from "discord.js";

import {
  buildOverrideBootstrapPrompt,
  buildVisibleOriginHistoryFacts
} from "../src/runtime/admin/override-bootstrap-prompt-context-service.js";

test("buildVisibleOriginHistoryFacts keeps human and bot messages in oldest-first order", () => {
  const history = new Collection<string, never>();
  history.set(
    "message-4",
    createMessage({
      id: "message-4",
      authorId: "user-4",
      authorBot: false,
      content: "",
      webhookId: "webhook-1"
    }) as never
  );
  history.set(
    "message-3",
    createMessage({
      id: "message-3",
      authorId: "user-3",
      authorBot: false,
      content: "これ治しといて",
      createdAt: "2026-03-13T09:03:00.000Z"
    }) as never
  );
  history.set(
    "message-2",
    createMessage({
      id: "message-2",
      authorId: "bot-1",
      authorBot: true,
      content: "候補は3つあります",
      createdAt: "2026-03-13T09:02:00.000Z"
    }) as never
  );
  history.set(
    "message-1",
    createMessage({
      id: "message-1",
      authorId: "user-1",
      authorBot: false,
      content: "この機能の実装計画を立てて",
      createdAt: "2026-03-13T09:01:00.000Z"
    }) as never
  );

  assert.deepEqual(buildVisibleOriginHistoryFacts(history as never), [
    {
      messageId: "message-1",
      authorId: "user-1",
      authorKind: "human",
      content: "この機能の実装計画を立てて",
      createdAt: "2026-03-13T09:01:00.000Z"
    },
    {
      messageId: "message-2",
      authorId: "bot-1",
      authorKind: "bot",
      content: "候補は3つあります",
      createdAt: "2026-03-13T09:02:00.000Z"
    },
    {
      messageId: "message-3",
      authorId: "user-3",
      authorKind: "human",
      content: "これ治しといて",
      createdAt: "2026-03-13T09:03:00.000Z"
    }
  ]);
});

test("buildOverrideBootstrapPrompt embeds origin facts and recent history", () => {
  const prompt = buildOverrideBootstrapPrompt({
    prompt: "この機能の実装計画立てておいて",
    origin: {
      guildId: "guild-1",
      channelId: "thread-1",
      rootChannelId: "forum-parent-1",
      threadId: "thread-1",
      mode: "forum_longform",
      placeType: "forum_post_thread"
    },
    history: [
      {
        messageId: "message-1",
        authorId: "user-1",
        authorKind: "human",
        content: "フォーラムで要件を整理していた",
        createdAt: "2026-03-13T09:01:00.000Z"
      },
      {
        messageId: "message-2",
        authorId: "bot-1",
        authorKind: "bot",
        content: "候補を3つに絞ります",
        createdAt: "2026-03-13T09:02:00.000Z"
      }
    ]
  });

  assert.match(prompt, /Requested task:\nこの機能の実装計画立てておいて/);
  assert.match(prompt, /mode: forum_longform/);
  assert.match(prompt, /place_type: forum_post_thread/);
  assert.match(prompt, /\[2026-03-13T09:01:00.000Z\] human:user-1/);
  assert.match(prompt, /候補を3つに絞ります/);
});

function createMessage(input: {
  id: string;
  authorId: string;
  authorBot: boolean;
  content: string;
  createdAt?: string;
  webhookId?: string | null;
  system?: boolean;
}) {
  return {
    id: input.id,
    author: {
      id: input.authorId,
      bot: input.authorBot
    },
    content: input.content,
    createdAt: new Date(input.createdAt ?? "2026-03-13T09:00:00.000Z"),
    webhookId: input.webhookId ?? null,
    system: input.system ?? false
  };
}
