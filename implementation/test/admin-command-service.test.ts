import assert from "node:assert/strict";
import test from "node:test";
import { ChannelType } from "discord.js";
import pino from "pino";

import type { AppConfig } from "../src/domain/types.js";
import { AdminCommandService } from "../src/runtime/admin/admin-command-service.js";

test("AdminCommandService accepts /override-start from chat root and bootstraps hidden prompt in admin_control", async () => {
  const bootstrapCalls: unknown[] = [];
  const contextCalls: unknown[] = [];
  const overrideThread = createThread("override-thread-1", "admin-root-1");
  const adminRootChannel = createBaseChannel("admin-root-1", {
    createdThread: overrideThread
  });
  const interaction = createInteraction({
    channel: createBaseChannel("chat-root-1"),
    channelId: "chat-root-1",
    guildId: "guild-1",
    prompt: "この機能の実装計画立てておいて"
  });
  const service = new AdminCommandService(
    {
      channels: {
        async fetch(channelId: string) {
          assert.equal(channelId, "admin-root-1");
          return adminRootChannel;
        }
      }
    } as never,
    createConfig(),
    createStore() as never,
    {} as never,
    {} as never,
    {
      async bootstrapPrompt(input: unknown) {
        bootstrapCalls.push(input);
      }
    } as never,
    {
      async buildEffectivePrompt(input: unknown) {
        contextCalls.push(input);
        return "hidden bootstrap prompt";
      }
    } as never,
    pino({ level: "silent" })
  );

  const handled = await service.handle(interaction as never);

  assert.equal(handled, true);
  assert.equal(adminRootChannel.created.length, 1);
  assert.equal(interaction.replies.length, 1);
  assert.match(
    interaction.replies[0] ?? "",
    /thread=<#override-thread-1>.*hidden bootstrap/
  );
  assert.deepEqual(overrideThread.sent, []);
  assert.equal(contextCalls.length, 1);
  assert.deepEqual(contextCalls[0], {
    prompt: "この機能の実装計画立てておいて",
    origin: {
      guildId: "guild-1",
      channelId: "chat-root-1",
      rootChannelId: "chat-root-1",
      threadId: null,
      mode: "chat",
      placeType: "chat_channel"
    },
    historyChannel: interaction.channel
  });
  assert.equal(bootstrapCalls.length, 1);
  assert.deepEqual(bootstrapCalls[0], {
    thread: overrideThread,
    watchLocation: {
      guildId: "guild-1",
      channelId: "admin-root-1",
      mode: "admin_control",
      defaultScope: "conversation_only"
    },
    actorId: "admin-1",
    actorRole: "admin",
    prompt: "この機能の実装計画立てておいて",
    effectiveContentOverride: "hidden bootstrap prompt",
    requestId: "override-bootstrap:interaction-1"
  });
});

test("AdminCommandService accepts /override-start from forum post thread", async () => {
  const contextCalls: unknown[] = [];
  const overrideThread = createThread("override-thread-2", "admin-root-1");
  const adminRootChannel = createBaseChannel("admin-root-1", {
    createdThread: overrideThread
  });
  const forumThread = createThread("forum-thread-1", "forum-parent-1", ChannelType.PublicThread);
  const interaction = createInteraction({
    channel: forumThread,
    channelId: "forum-thread-1",
    guildId: "guild-1",
    prompt: "これ治しといて"
  });
  const service = new AdminCommandService(
    {
      channels: {
        async fetch() {
          return adminRootChannel;
        }
      }
    } as never,
    {
      ...createConfig(),
      watchLocations: [
        {
          guildId: "guild-1",
          channelId: "forum-parent-1",
          mode: "forum_longform",
          defaultScope: "conversation_only"
        },
        {
          guildId: "guild-1",
          channelId: "admin-root-1",
          mode: "admin_control",
          defaultScope: "conversation_only"
        }
      ]
    },
    createStore() as never,
    {} as never,
    {} as never,
    {
      async bootstrapPrompt() {}
    } as never,
    {
      async buildEffectivePrompt(input: unknown) {
        contextCalls.push(input);
        return "hidden forum bootstrap prompt";
      }
    } as never,
    pino({ level: "silent" })
  );

  const handled = await service.handle(interaction as never);

  assert.equal(handled, true);
  assert.equal(contextCalls.length, 1);
  assert.deepEqual(contextCalls[0], {
    prompt: "これ治しといて",
    origin: {
      guildId: "guild-1",
      channelId: "forum-thread-1",
      rootChannelId: "forum-parent-1",
      threadId: "forum-thread-1",
      mode: "forum_longform",
      placeType: "forum_post_thread"
    },
    historyChannel: forumThread
  });
});

function createConfig(): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "app-1",
    discordOwnerUserIds: [],
    botDbPath: "bot.sqlite",
    botLogLevel: "debug",
    codexAppServerCommand: "codex",
    codexHomePath: null,
    watchLocations: [
      {
        guildId: "guild-1",
        channelId: "chat-root-1",
        mode: "chat",
        defaultScope: "conversation_only"
      },
      {
        guildId: "guild-1",
        channelId: "admin-root-1",
        mode: "admin_control",
        defaultScope: "conversation_only"
      }
    ],
    chatRuntimeControls: null,
    weeklyMeetupAnnouncement: null
  };
}

function createStore() {
  const started: unknown[] = [];

  return {
    overrideSessions: {
      started,
      start(input: unknown) {
        started.push(input);
      },
      getActive() {
        return null;
      },
      endActive() {
        return false;
      }
    }
  };
}

function createInteraction(input: {
  channel: ReturnType<typeof createBaseChannel> | ReturnType<typeof createThread>;
  channelId: string;
  guildId: string;
  prompt: string;
}) {
  return {
    id: "interaction-1",
    commandName: "override-start",
    guildId: input.guildId,
    channelId: input.channelId,
    channel: input.channel,
    user: {
      id: "admin-1",
      username: "admin"
    },
    memberPermissions: {
      has() {
        return true;
      }
    },
    options: {
      getString(name: string) {
        return name === "prompt" ? input.prompt : null;
      },
      getBoolean() {
        return null;
      }
    },
    replied: false,
    deferred: false,
    replies: [] as string[],
    inCachedGuild() {
      return true;
    },
    async reply(payload: { content: string }) {
      this.replies.push(payload.content);
      this.replied = true;
    },
    async followUp(payload: { content: string }) {
      this.replies.push(payload.content);
    }
  };
}

function createBaseChannel(
  id: string,
  input?: {
    createdThread?: ReturnType<typeof createThread>;
  }
) {
  const created: unknown[] = [];

  return {
    id,
    type: ChannelType.GuildText,
    created,
    isThread() {
      return false;
    },
    threads: {
      create: async (options: unknown) => {
        created.push(options);
        return input?.createdThread ?? createThread(`override-${id}`, id);
      }
    }
  };
}

function createThread(
  id: string,
  parentId: string,
  type = ChannelType.PublicThread
) {
  return {
    id,
    parentId,
    type,
    sent: [] as string[],
    isThread() {
      return true;
    },
    async send(payload: { content: string }) {
      this.sent.push(payload.content);
    }
  };
}
