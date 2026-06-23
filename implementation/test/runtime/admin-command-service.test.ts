import test from "node:test";
import assert from "node:assert/strict";
import { ChannelType, type Channel } from "discord.js";

import {
  AdminCommandService,
  buildOverrideCommandDefinitions,
  canStartOverrideFromOrigin
} from "../../src/runtime/admin/admin-command-service.js";
import type { AppConfig, WatchLocationConfig } from "../../src/domain/types.js";
import type { ThreadWorkflowRouteRow } from "../../src/storage/types.js";

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

test("command definitions include workflow-switch with allowed workflow choices", () => {
  const commands = buildOverrideCommandDefinitions() as Array<{
    name?: string;
    options?: Array<{
      name?: string;
      choices?: Array<{ name: string; value: string }>;
    }>;
  }>;
  const commandNames = commands.map((command) => command.name).sort();

  for (const commandName of [
    "override-end",
    "override-start",
    "weekly-meetup-test",
    "workflow-switch"
  ]) {
    assert.ok(commandNames.includes(commandName), `${commandName} is registered`);
  }

  const workflowSwitch = commands.find((command) => command.name === "workflow-switch");
  assert.ok(workflowSwitch);
  const workflowOption = workflowSwitch.options?.find(
    (option) => option.name === "workflow"
  );
  assert.ok(workflowOption);
  assert.deepEqual(
    workflowOption.choices?.map((choice) => choice.value).sort(),
    ["clear_explanation", "forum_research"]
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

test("workflow-switch lets the question thread starter switch an existing route", async () => {
  const { service, gateway, store } = createWorkflowSwitchService({
    route: createWorkflowRoute()
  });
  const { interaction, replies } = createWorkflowSwitchInteraction({
    userId: "starter-user",
    isAdmin: false,
    workflow: "forum_research",
    channel: createThreadChannel({
      starterAuthorId: "starter-user"
    })
  });

  const handled = await service.handle(interaction as never);

  assert.equal(handled, true);
  assert.equal(gateway.calls.length, 1);
  assert.deepEqual(gateway.calls[0], {
    threadId: "question-thread",
    rootChannelId: "question-root",
    firstMessageId: "starter-message",
    workflow: "forum_research",
    actorId: "starter-user",
    reason: "manual switch"
  });
  assert.equal(store.route?.workflow, "forum_research");
  assert.equal(store.route?.selected_by, "command");
  assert.equal(store.route?.selected_by_actor_id, "starter-user");
  assert.match(replies[0] ?? "", /forum_research/);
});

test("workflow-switch lets an owner or admin switch even when not the starter", async () => {
  const { service, gateway, store } = createWorkflowSwitchService({
    route: createWorkflowRoute()
  });
  const { interaction, replies } = createWorkflowSwitchInteraction({
    userId: "admin-user",
    isAdmin: true,
    workflow: "clear_explanation",
    channel: createThreadChannel({
      starterAuthorId: "starter-user"
    })
  });

  const handled = await service.handle(interaction as never);

  assert.equal(handled, true);
  assert.equal(gateway.calls.length, 1);
  assert.equal(gateway.calls[0]?.actorId, "admin-user");
  assert.equal(store.route?.workflow, "clear_explanation");
  assert.equal(store.route?.selected_by_actor_id, "admin-user");
  assert.match(replies[0] ?? "", /clear_explanation/);
});

test("workflow-switch rejects a user who is neither starter nor owner/admin", async () => {
  const { service, gateway, store } = createWorkflowSwitchService({
    route: createWorkflowRoute()
  });
  const { interaction, replies } = createWorkflowSwitchInteraction({
    userId: "random-user",
    isAdmin: false,
    workflow: "forum_research",
    channel: createThreadChannel({
      starterAuthorId: "starter-user"
    })
  });

  const handled = await service.handle(interaction as never);

  assert.equal(handled, true);
  assert.equal(gateway.calls.length, 0);
  assert.equal(store.route?.workflow, "clear_explanation");
  assert.equal(store.route?.selected_by, "starter_gateway");
  assert.match(replies[0] ?? "", /thread starter|owner\/admin/);
});

test("workflow-switch rejects commands outside a question-gateway thread", async () => {
  const { service, gateway, store } = createWorkflowSwitchService({
    route: createWorkflowRoute({
      root_channel_id: "plain-root"
    }),
    watchLocations: [
      {
        guildId: "guild",
        channelId: "plain-root",
        mode: "chat",
        defaultScope: "conversation_only",
        features: ["conversation"]
      }
    ]
  });
  const { interaction, replies } = createWorkflowSwitchInteraction({
    userId: "starter-user",
    isAdmin: false,
    workflow: "forum_research",
    channel: createThreadChannel({
      parentId: "plain-root",
      starterAuthorId: "starter-user"
    })
  });

  const handled = await service.handle(interaction as never);

  assert.equal(handled, true);
  assert.equal(gateway.calls.length, 0);
  assert.equal(store.route?.workflow, "clear_explanation");
  assert.match(replies[0] ?? "", /question_gateway|question-gateway/);
});

test("workflow-switch rejects when the thread has no existing route row", async () => {
  const { service, gateway, store } = createWorkflowSwitchService({
    route: null
  });
  const { interaction, replies } = createWorkflowSwitchInteraction({
    userId: "starter-user",
    isAdmin: false,
    workflow: "forum_research",
    channel: createThreadChannel({
      starterAuthorId: "starter-user"
    })
  });

  const handled = await service.handle(interaction as never);

  assert.equal(handled, true);
  assert.equal(gateway.calls.length, 0);
  assert.equal(store.route, null);
  assert.match(replies[0] ?? "", /保存されていない|existing route|初期化/);
});

function createConfig(watchLocations: WatchLocationConfig[]): AppConfig {
  return {
    discordBotToken: "token",
    discordApplicationId: "application",
    discordOwnerUserIds: ["owner-user"],
    botDbPath: ":memory:",
    botLogLevel: "info",
    runtime: {
      maxConcurrentKeys: 4,
      retryPollIntervalMs: 15_000,
      codexIdleCloseMs: 1_800_000,
      ambientSparseInterval: 5
    },
    codexAppServerCommand: "codex",
    codexHomePath: null,
    watchLocations,
    chatRuntimeControls: null,
    weeklyMeetupAnnouncement: null
  };
}

function createWorkflowSwitchService(input: {
  route: ThreadWorkflowRouteRow | null;
  watchLocations?: WatchLocationConfig[];
}) {
  const store = createWorkflowRouteStore(input.route);
  const gateway = createWorkflowGatewayDouble(store);
  const logger = { warn: () => undefined, debug: () => undefined } as never;
  const ServiceCtor = AdminCommandService as unknown as {
    new (...args: unknown[]): AdminCommandService;
  };
  const service = new ServiceCtor(
    {
      channels: {
        fetch: async () => null
      }
    },
    createConfig(input.watchLocations ?? [questionGatewayWatchLocation()]),
    store,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    logger,
    gateway
  );

  return {
    service,
    gateway,
    store
  };
}

function createWorkflowRouteStore(initialRoute: ThreadWorkflowRouteRow | null) {
  const state = {
    route: initialRoute,
    marks: [] as Array<{
      threadId: string;
      rootChannelId: string;
      firstMessageId: string;
      workflow: "clear_explanation" | "forum_research";
      selectedBy: "starter_gateway" | "command";
      selectedByActorId: string | null;
      reason: string | null;
    }>,
    threadWorkflowRoutes: {
      get: (threadId: string) =>
        state.route?.thread_id === threadId ? state.route : null,
      mark: (mark: {
        threadId: string;
        rootChannelId: string;
        firstMessageId: string;
        workflow: "clear_explanation" | "forum_research";
        selectedBy: "starter_gateway" | "command";
        selectedByActorId: string | null;
        reason: string | null;
      }) => {
        state.marks.push(mark);
        const now = "2026-05-21T00:00:00.000Z";
        state.route = {
          thread_id: mark.threadId,
          root_channel_id: mark.rootChannelId,
          first_message_id: mark.firstMessageId,
          workflow: mark.workflow,
          selected_by: mark.selectedBy,
          selected_by_actor_id: mark.selectedByActorId,
          reason: mark.reason,
          created_at: state.route?.created_at ?? now,
          updated_at: now
        };
      }
    },
    overrideSessions: {
      start: () => undefined,
      getActive: () => null,
      endActive: () => false
    }
  };
  return state;
}

function createWorkflowGatewayDouble(
  store: ReturnType<typeof createWorkflowRouteStore>
) {
  const gateway = {
    calls: [] as Array<{
      threadId: string;
      rootChannelId: string;
      firstMessageId: string;
      workflow: string;
      actorId: string;
      reason: string | null;
    }>,
    switchWorkflow: (input: {
      threadId: string;
      rootChannelId: string;
      firstMessageId: string;
      workflow: string;
      actorId: string;
      reason: string | null;
    }) => {
      gateway.calls.push(input);
      if (
        input.workflow !== "clear_explanation" &&
        input.workflow !== "forum_research"
      ) {
        return {
          ok: false as const,
          reason: "forbidden_workflow" as const
        };
      }

      store.threadWorkflowRoutes.mark({
        threadId: input.threadId,
        rootChannelId: input.rootChannelId,
        firstMessageId: input.firstMessageId,
        workflow: input.workflow,
        selectedBy: "command",
        selectedByActorId: input.actorId,
        reason: input.reason
      });
      return {
        ok: true as const,
        workflow: input.workflow
      };
    }
  };
  return gateway;
}

function createWorkflowSwitchInteraction(input: {
  userId: string;
  isAdmin: boolean;
  workflow: string;
  channel: ReturnType<typeof createThreadChannel>;
}) {
  const replies: string[] = [];
  return {
    replies,
    interaction: {
      commandName: "workflow-switch",
      inCachedGuild: () => true,
      guildId: "guild",
      channelId: input.channel.id,
      channel: input.channel,
      id: "interaction-workflow-switch",
      user: {
        id: input.userId,
        username: input.userId
      },
      memberPermissions: {
        has: () => input.isAdmin
      },
      options: {
        getString: (name: string) => {
          if (name === "workflow") {
            return input.workflow;
          }
          if (name === "reason") {
            return "manual switch";
          }
          return null;
        },
        getBoolean: () => null
      },
      replied: false,
      deferred: false,
      reply: async (replyInput: { content: string }) => {
        replies.push(replyInput.content);
      },
      followUp: async (replyInput: { content: string }) => {
        replies.push(replyInput.content);
      }
    }
  };
}

function createThreadChannel(input: {
  threadId?: string;
  parentId?: string;
  starterMessageId?: string;
  starterAuthorId: string;
}) {
  return {
    id: input.threadId ?? "question-thread",
    type: ChannelType.PublicThread,
    parentId: input.parentId ?? "question-root",
    isThread: () => true,
    fetchStarterMessage: async () => ({
      id: input.starterMessageId ?? "starter-message",
      author: {
        id: input.starterAuthorId
      }
    })
  };
}

function createWorkflowRoute(
  overrides: Partial<ThreadWorkflowRouteRow> = {}
): ThreadWorkflowRouteRow {
  return {
    thread_id: "question-thread",
    root_channel_id: "question-root",
    first_message_id: "starter-message",
    workflow: "clear_explanation",
    selected_by: "starter_gateway",
    selected_by_actor_id: null,
    reason: "starter selected route",
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    ...overrides
  };
}

function questionGatewayWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild",
    channelId: "question-root",
    mode: "chat",
    defaultScope: "conversation_only",
    features: ["question_gateway", "conversation"]
  };
}
