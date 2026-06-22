import test from "node:test";
import assert from "node:assert/strict";
import { ChannelType, type Channel } from "discord.js";

import {
  AdminCommandService,
  canStartOverrideFromOrigin
} from "../../src/runtime/admin/admin-command-service.js";
import type { AppConfig, WatchLocationConfig } from "../../src/domain/types.js";

test("override-start cannot begin from an unconfigured origin channel", () => {
  assert.equal(
    canStartOverrideFromOrigin({} as Channel, null),
    false
  );
});

test("override-start can begin from a configured origin channel", () => {
  assert.equal(
    canStartOverrideFromOrigin({} as Channel, {
      guildId: "guild",
      channelId: "chat-root",
      mode: "chat",
      defaultScope: "server_public",
      features: ["conversation"]
    }),
    true
  );
});

test("override-start rejects normal users before creating an override thread", async () => {
  let fetchedChannel = false;
  let startedSession = false;
  const replies: string[] = [];
  const service = new AdminCommandService(
    {
      channels: {
        fetch: async () => {
          fetchedChannel = true;
          throw new Error("channel fetch should not run");
        }
      }
    } as never,
    createConfig([
      {
        guildId: "guild",
        channelId: "admin-root",
        mode: "admin_control",
        defaultScope: "conversation_only",
        features: ["admin_override", "conversation"]
      }
    ]),
    {
      overrideSessions: {
        start: () => {
          startedSession = true;
        }
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { warn: () => undefined, debug: () => undefined } as never
  );

  const handled = await service.handle({
    commandName: "override-start",
    inCachedGuild: () => true,
    guildId: "guild",
    channelId: "origin-root",
    channel: { id: "origin-root", isThread: () => false },
    id: "interaction-1",
    user: {
      id: "regular-user",
      username: "regular"
    },
    memberPermissions: {
      has: () => false
    },
    options: {
      getString: () => null,
      getBoolean: () => null
    },
    replied: false,
    deferred: false,
    reply: async (input: { content: string }) => {
      replies.push(input.content);
    }
  } as never);

  assert.equal(handled, true);
  assert.equal(fetchedChannel, false);
  assert.equal(startedSession, false);
  assert.match(replies[0] ?? "", /owner\/admin/);
});

test("override-start with initial prompt copies only visible prompt and bootstraps with effective content", async () => {
  const initialPrompt = "これ対応させるPR出しといて";
  const effectiveContentOverride = "hidden bootstrap prompt with origin facts";
  const originWatchLocation: WatchLocationConfig = {
    guildId: "guild",
    channelId: "origin-root",
    mode: "chat",
    defaultScope: "conversation_only",
    features: ["conversation"]
  };
  const adminWatchLocation: WatchLocationConfig = {
    guildId: "guild",
    channelId: "admin-root",
    mode: "admin_control",
    defaultScope: "conversation_only",
    features: ["admin_override", "conversation"]
  };
  const visibleThreadMessages: string[] = [];
  const overrideThread = {
    id: "override-thread",
    type: ChannelType.PublicThread,
    send: async (input: { content: string }) => {
      visibleThreadMessages.push(input.content);
    }
  };
  const createdThreads: Array<{ name: string; reason: string }> = [];
  const adminRootChannel = {
    id: "admin-root",
    type: ChannelType.GuildText,
    threads: {
      create: async (input: { name: string; reason: string }) => {
        createdThreads.push(input);
        return overrideThread;
      }
    }
  };
  const originChannel = {
    id: "origin-root",
    type: ChannelType.GuildText,
    isThread: () => false
  };
  const startedSessions: Array<{ scopePlaceId: string; sandboxMode: string }> = [];
  const bootstrapCalls: Array<{
    prompt: string;
    effectiveContentOverride?: string | null;
  }> = [];
  const contextInputs: Array<{
    prompt: string;
    origin: {
      guildId: string;
      channelId: string;
      rootChannelId: string;
      threadId: string | null;
      mode: string;
      placeType: string;
    };
    historyChannel: unknown;
  }> = [];
  const replies: string[] = [];
  const service = new AdminCommandService(
    {
      channels: {
        fetch: async (channelId: string) => {
          assert.equal(channelId, "admin-root");
          return adminRootChannel;
        }
      }
    } as never,
    createConfig([adminWatchLocation, originWatchLocation]),
    {
      overrideSessions: {
        start: (input: { scopePlaceId: string; sandboxMode: string }) => {
          startedSessions.push(input);
        }
      }
    } as never,
    {} as never,
    {} as never,
    {
      bootstrapPrompt: async (input: {
        prompt: string;
        effectiveContentOverride?: string | null;
      }) => {
        bootstrapCalls.push(input);
      }
    } as never,
    {
      buildEffectivePrompt: async (input: {
        prompt: string;
        origin: {
          guildId: string;
          channelId: string;
          rootChannelId: string;
          threadId: string | null;
          mode: string;
          placeType: string;
        };
        historyChannel: unknown;
      }) => {
        contextInputs.push(input);
        return effectiveContentOverride;
      }
    } as never,
    {} as never,
    { warn: () => undefined, debug: () => undefined } as never
  );

  const handled = await service.handle({
    commandName: "override-start",
    inCachedGuild: () => true,
    guildId: "guild",
    channelId: "origin-root",
    channel: originChannel,
    id: "interaction-1",
    user: {
      id: "admin-user",
      username: "admin"
    },
    memberPermissions: {
      has: () => true
    },
    options: {
      getString: (name: string) => (name === "prompt" ? initialPrompt : null),
      getBoolean: () => null
    },
    replied: false,
    deferred: false,
    reply: async (input: { content: string }) => {
      replies.push(input.content);
    }
  } as never);

  assert.equal(handled, true);
  assert.equal(createdThreads.length, 1);
  assert.deepEqual(visibleThreadMessages, [`初回 prompt:\n${initialPrompt}`]);
  assert.deepEqual(contextInputs, [
    {
      prompt: initialPrompt,
      origin: {
        guildId: "guild",
        channelId: "origin-root",
        rootChannelId: "origin-root",
        threadId: null,
        mode: "chat",
        placeType: "chat_channel"
      },
      historyChannel: originChannel
    }
  ]);
  assert.equal(bootstrapCalls.length, 1);
  assert.equal(bootstrapCalls[0]?.prompt, initialPrompt);
  assert.equal(bootstrapCalls[0]?.effectiveContentOverride, effectiveContentOverride);
  assert.equal(startedSessions.length, 1);
  assert.equal(startedSessions[0]?.scopePlaceId, "override-thread");
  assert.equal(startedSessions[0]?.sandboxMode, "workspace-write");
  assert.notEqual(startedSessions[0]?.scopePlaceId, "origin-root");
  assert.match(replies[0] ?? "", /thread=<#override-thread>/);
});

function createConfig(watchLocations: WatchLocationConfig[]): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "application",
    discordOwnerUserIds: ["owner-user"],
    botDbPath: ":memory:",
    botLogLevel: "info",
    codexAppServerCommand: "codex",
    codexHomePath: null,
    watchLocations,
    weeklyMeetupAnnouncement: null
  };
}
