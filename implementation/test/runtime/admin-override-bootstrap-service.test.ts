import test from "node:test";
import assert from "node:assert/strict";
import { Collection, type Message, type Snowflake } from "discord.js";

import {
  OverrideBootstrapPromptContextService,
  buildOverrideBootstrapPrompt,
  buildVisibleOriginHistoryFacts
} from "../../src/runtime/admin/override-bootstrap-prompt-context-service.js";

test("override bootstrap prompt includes recent visible origin history oldest-first with origin facts", () => {
  const history = new Collection<Snowflake, Message<true>>([
    [
      "msg-004",
      fakeMessage({
        id: "msg-004",
        authorId: "human-2",
        content: "では title validator のテストを足して",
        createdAt: "2026-06-22T10:03:00.000Z"
      })
    ],
    [
      "msg-003",
      fakeMessage({
        id: "msg-003",
        authorId: "bot-user",
        bot: true,
        content: "validator は implementation/src/... を見ます",
        createdAt: "2026-06-22T10:02:00.000Z"
      })
    ],
    [
      "msg-002",
      fakeMessage({
        id: "msg-002",
        authorId: "human-1",
        content: "PR title validation が command 側で落ちています",
        createdAt: "2026-06-22T10:01:00.000Z"
      })
    ],
    [
      "msg-001",
      fakeMessage({
        id: "msg-001",
        authorId: "bot-user",
        bot: true,
        content: "古い別件です",
        createdAt: "2026-06-22T10:00:00.000Z"
      })
    ]
  ]);

  const visibleHistory = buildVisibleOriginHistoryFacts(history, "bot-user");
  const prompt = buildOverrideBootstrapPrompt({
    prompt: "これ対応させるPR出しといて",
    origin: {
      guildId: "guild-1",
      channelId: "origin-channel",
      rootChannelId: "origin-root",
      threadId: "origin-thread",
      mode: "chat",
      placeType: "public_thread"
    },
    history: visibleHistory
  });

  assert.deepEqual(
    visibleHistory.map((message) => message.messageId),
    ["msg-002", "msg-003", "msg-004"]
  );
  assert.match(prompt, /Requested task:\nこれ対応させるPR出しといて/);
  assert.match(prompt, /- guild_id: guild-1/);
  assert.match(prompt, /- mode: chat/);
  assert.match(prompt, /- place_type: public_thread/);
  assert.match(prompt, /- channel_id: origin-channel/);
  assert.match(prompt, /- root_channel_id: origin-root/);
  assert.match(prompt, /- thread_id: origin-thread/);
  assert.match(
    prompt,
    /1\. \[2026-06-22T10:01:00\.000Z\] human:human-1\nPR title validation が command 側で落ちています/
  );
  assert.match(
    prompt,
    /2\. \[2026-06-22T10:02:00\.000Z\] bot:bot-user\nvalidator は implementation\/src\/\.\.\. を見ます/
  );
  assert.match(
    prompt,
    /3\. \[2026-06-22T10:03:00\.000Z\] human:human-2\nでは title validator のテストを足して/
  );
  assert.doesNotMatch(prompt, /古い別件です/);
});

test("override bootstrap prompt remains usable when visible origin history is unavailable", async () => {
  const service = new OverrideBootstrapPromptContextService({
    warn: () => undefined
  });

  const prompt = await service.buildEffectivePrompt({
    prompt: "これ対応させるPR出しといて",
    origin: {
      guildId: "guild-1",
      channelId: "origin-channel",
      rootChannelId: "origin-channel",
      threadId: null,
      mode: "chat",
      placeType: "chat_channel"
    },
    historyChannel: null
  });

  assert.match(prompt, /Requested task:\nこれ対応させるPR出しといて/);
  assert.match(prompt, /\(no recent visible conversation context available\)/);
});

function fakeMessage(input: {
  id: string;
  authorId: string;
  bot?: boolean;
  content: string;
  createdAt: string;
}): Message<true> {
  return {
    id: input.id,
    author: {
      id: input.authorId,
      bot: input.bot ?? false
    },
    content: input.content,
    createdAt: new Date(input.createdAt),
    webhookId: null,
    system: false
  } as Message<true>;
}
