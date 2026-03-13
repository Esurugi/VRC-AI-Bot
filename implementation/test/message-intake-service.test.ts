import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChannelType } from "discord.js";
import pino from "pino";

import type { AppConfig, WatchLocationConfig } from "../src/domain/types.js";
import { ChatChannelCounterService } from "../src/runtime/chat/chat-channel-counter-service.js";
import { ChatEngagementPolicy } from "../src/runtime/chat/chat-engagement-policy.js";
import { ChatRuntimeControlService } from "../src/runtime/chat/chat-runtime-control-service.js";
import { ForumThreadService } from "../src/runtime/forum/forum-thread-service.js";
import { MessageIntakeService } from "../src/runtime/message/message-intake-service.js";
import type { QueuedMessage } from "../src/runtime/types.js";
import { SqliteStore } from "../src/storage/database.js";

const REPO_ROOT = process.cwd();
const WATCH_LOCATION: WatchLocationConfig = {
  guildId: "guild-1",
  channelId: "channel-1",
  mode: "chat",
  defaultScope: "channel_family"
};

const CONFIG: AppConfig = {
  discordBotToken: "token",
  discordApplicationId: "app-id",
  discordOwnerUserIds: ["owner-1"],
  botDbPath: "./bot.sqlite",
  botLogLevel: "info",
  codexAppServerCommand: "codex app-server",
  codexHomePath: null,
  watchLocations: [WATCH_LOCATION],
  weeklyMeetupAnnouncement: null
};

test("MessageIntakeService enqueues mentions, bot replies, and question messages without incrementing sparse counters", async () => {
  const fixture = createFixture();

  try {
    await fixture.service.handle(
      createMessage({
        id: "1001",
        content: "<@bot-1> こんにちは",
        mentionsBot: true
      })
    );
    await fixture.service.handle(
      createMessage({
        id: "1002",
        content: "続けて",
        referenceMessageId: "bot-message-1",
        repliedUserId: null,
        fetchReferenceAuthorId: "bot-1"
      })
    );
    await fixture.service.handle(
      createMessage({
        id: "1003",
        content: "これはどう？"
      })
    );

    assert.deepEqual(
      fixture.enqueued.map((item) => item.messageId),
      ["1001", "1002", "1003"]
    );
    assert.equal(fixture.store.chatChannelCounters.get("channel-1"), null);
  } finally {
    fixture.close();
  }
});

test("MessageIntakeService applies sparse chat engagement every fifth ordinary message", async () => {
  const fixture = createFixture();

  try {
    for (let index = 1; index <= 10; index += 1) {
      await fixture.service.handle(
        createMessage({
          id: String(2000 + index),
          content: `message ${index}`
        })
      );
    }

    assert.deepEqual(
      fixture.enqueued.map((item) => item.messageId),
      ["2005", "2010"]
    );
    assert.equal(
      fixture.store.chatChannelCounters.get("channel-1")?.ordinary_message_count,
      10
    );
  } finally {
    fixture.close();
  }
});

test("MessageIntakeService keeps separate sparse counters for root channels and threads", async () => {
  const fixture = createFixture();

  try {
    for (let index = 1; index <= 5; index += 1) {
      await fixture.service.handle(
        createMessage({
          id: String(3000 + index),
          content: `root ${index}`
        })
      );
      await fixture.service.handle(
        createMessage({
          id: String(4000 + index),
          content: `thread ${index}`,
          channelId: "thread-1",
          parentId: "channel-1",
          channelType: ChannelType.PublicThread,
          isThread: true
        })
      );
    }

    assert.deepEqual(
      fixture.enqueued.map((item) => item.messageId),
      ["3005", "4005"]
    );
    assert.equal(
      fixture.store.chatChannelCounters.get("channel-1")?.ordinary_message_count,
      5
    );
    assert.equal(
      fixture.store.chatChannelCounters.get("thread-1")?.ordinary_message_count,
      5
    );
  } finally {
    fixture.close();
  }
});

test("MessageIntakeService starts sparse counting from 1 after startup reset", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-intake-"));
  const dbPath = join(tempDir, "bot.sqlite");
  let firstStore: SqliteStore | undefined;
  let secondStore: SqliteStore | undefined;

  try {
    const first = createFixture({ dbPath });
    firstStore = first.store;

    for (let index = 1; index <= 4; index += 1) {
      await first.service.handle(
        createMessage({
          id: String(5000 + index),
          content: `before ${index}`
        })
      );
    }
    first.close();
    firstStore = undefined;

    const second = createFixture({ dbPath });
    secondStore = second.store;
    second.chatChannelCounterService.resetAll();

    await second.service.handle(
      createMessage({
        id: "5005",
        content: "after restart"
      })
    );

    assert.deepEqual(
      second.enqueued.map((item) => item.messageId),
      []
    );
    assert.equal(
      second.store.chatChannelCounters.get("channel-1")?.ordinary_message_count,
      1
    );
    second.close();
    secondStore = undefined;
  } finally {
    firstStore?.close();
    secondStore?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MessageIntakeService does not enqueue or count chat messages when controls disable chat", async () => {
  const fixture = createFixture({
    configOverrides: {
      chatRuntimeControls: {
        enabled: false,
        enabledChannelIds: []
      }
    }
  });

  try {
    await fixture.service.handle(
      createMessage({
        id: "5501",
        content: "muted chat"
      })
    );

    assert.deepEqual(fixture.enqueued, []);
    assert.equal(fixture.store.chatChannelCounters.get("channel-1"), null);
  } finally {
    fixture.close();
  }
});

test("MessageIntakeService enables allowlisted chat roots and their threads only", async () => {
  const fixture = createFixture({
    watchLocation: WATCH_LOCATION,
    configOverrides: {
      watchLocations: [
        WATCH_LOCATION,
        {
          guildId: "guild-1",
          channelId: "channel-2",
          mode: "chat",
          defaultScope: "channel_family"
        }
      ],
      chatRuntimeControls: {
        enabled: true,
        enabledChannelIds: ["channel-2"]
      }
    }
  });

  try {
    for (let index = 1; index <= 5; index += 1) {
      await fixture.service.handle(
        createMessage({
          id: `560${index}`,
          content: `blocked ${index}`
        })
      );
      await fixture.service.handle(
        createMessage({
          id: `570${index}`,
          channelId: `thread-2`,
          parentId: "channel-2",
          channelType: ChannelType.PublicThread,
          isThread: true,
          content: `allowed thread ${index}`
        })
      );
    }

    assert.deepEqual(
      fixture.enqueued.map((item) => item.messageId),
      ["5705"]
    );
    assert.equal(fixture.store.chatChannelCounters.get("channel-1"), null);
    assert.equal(
      fixture.store.chatChannelCounters.get("thread-2")?.ordinary_message_count,
      5
    );
  } finally {
    fixture.close();
  }
});

test("MessageIntakeService bypasses sparse counting for forum threads", async () => {
  const fixture = createFixture({
    watchLocation: {
      guildId: "guild-1",
      channelId: "forum-parent-1",
      mode: "forum_longform",
      defaultScope: "conversation_only"
    }
  });

  try {
    await fixture.service.handle(
      createMessage({
        id: "6001",
        content: "first forum post",
        channelId: "forum-thread-1",
        parentId: "forum-parent-1",
        channelType: ChannelType.PublicThread,
        isThread: true
      })
    );
    await fixture.service.handle(
      createMessage({
        id: "6002",
        content: "second forum post",
        channelId: "forum-thread-1",
        parentId: "forum-parent-1",
        channelType: ChannelType.PublicThread,
        isThread: true
      })
    );

    assert.deepEqual(
      fixture.enqueued.map((item) => item.messageId),
      ["6001", "6002"]
    );
    assert.equal(fixture.store.chatChannelCounters.get("forum-thread-1"), null);
  } finally {
    fixture.close();
  }
});

test("MessageIntakeService ignores the forum parent channel itself", async () => {
  const fixture = createFixture({
    watchLocation: {
      guildId: "guild-1",
      channelId: "forum-parent-1",
      mode: "forum_longform",
      defaultScope: "conversation_only"
    }
  });

  try {
    await fixture.service.handle(
      createMessage({
        id: "7001",
        content: "parent forum payload",
        channelId: "forum-parent-1",
        channelType: ChannelType.GuildForum,
        isThread: false
      })
    );

    assert.deepEqual(fixture.enqueued, []);
  } finally {
    fixture.close();
  }
});

function createFixture(input: {
  dbPath?: string;
  watchLocation?: WatchLocationConfig;
  configOverrides?: Partial<AppConfig>;
} = {}) {
  const tempDir =
    input.dbPath == null
      ? mkdtempSync(join(tmpdir(), "vrc-ai-bot-intake-"))
      : null;
  const dbPath = input.dbPath ?? join(tempDir!, "bot.sqlite");
  const store = new SqliteStore(dbPath, REPO_ROOT);
  store.migrate();
  const enqueued: QueuedMessage[] = [];
  const config: AppConfig = {
    ...CONFIG,
    watchLocations: [input.watchLocation ?? WATCH_LOCATION],
    ...input.configOverrides
  };
  const chatChannelCounterService = new ChatChannelCounterService(store);
  const queue = {
    enqueue(item: QueuedMessage) {
      enqueued.push(item);
      return true;
    }
  };

  const service = new MessageIntakeService(
    config,
    queue as never,
    chatChannelCounterService,
    new ChatEngagementPolicy(),
    new ChatRuntimeControlService(config.chatRuntimeControls ?? null),
    new ForumThreadService(),
    pino({ level: "silent" })
  );

  return {
    store,
    chatChannelCounterService,
    service,
    enqueued,
    close() {
      store.close();
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  };
}

function createMessage(input: {
  id: string;
  content: string;
  channelId?: string;
  parentId?: string | null;
  channelType?: ChannelType;
  isThread?: boolean;
  mentionsBot?: boolean;
  repliedUserId?: string | null;
  referenceMessageId?: string | null;
  fetchReferenceAuthorId?: string | null;
}) {
  const channelId = input.channelId ?? "channel-1";
  const isThread = input.isThread ?? false;
  const clientUserId = "bot-1";

  return {
    id: input.id,
    guildId: "guild-1",
    channelId,
    content: input.content,
    createdAt: new Date("2026-03-10T00:00:00.000Z"),
    webhookId: null,
    inGuild: () => true,
    author: {
      id: "user-1",
      bot: false
    },
    client: {
      user: {
        id: clientUserId
      }
    },
    member: {
      permissions: {
        has: () => false
      }
    },
    mentions: {
      has: (userId: string) => input.mentionsBot === true && userId === clientUserId,
      repliedUser:
        input.repliedUserId === undefined
          ? null
          : input.repliedUserId === null
            ? null
            : { id: input.repliedUserId }
    },
    reference:
      input.referenceMessageId == null
        ? null
        : {
            messageId: input.referenceMessageId
          },
    fetchReference: async () => ({
      author: {
        id: input.fetchReferenceAuthorId ?? "user-2"
      }
    }),
    react: async () => undefined,
    channel: {
      id: channelId,
      type: input.channelType ?? ChannelType.GuildText,
      parentId: input.parentId ?? null,
      isThread: () => isThread,
      sendTyping: async () => undefined
    }
  } as never;
}
