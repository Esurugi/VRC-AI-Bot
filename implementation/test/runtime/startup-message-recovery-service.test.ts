import test from "node:test";
import assert from "node:assert/strict";

import {
  ChannelType,
  Collection,
  type AnyThreadChannel,
  type Message,
  type NewsChannel,
  type TextChannel
} from "discord.js";

import { StartupMessageRecoveryService } from "../../src/runtime/message/startup-message-recovery-service.js";
import type { WatchLocationConfig } from "../../src/domain/types.js";
import type { SqliteStore } from "../../src/storage/database.js";
import type { MessageIntakeService } from "../../src/runtime/message/message-intake-service.js";

test("startup recovery replays root backlog in chronological order", async () => {
  const handled: string[] = [];
  const service = new StartupMessageRecoveryService({
    watchLocations: [createWatchLocation()],
    store: createStore({
      "watch-root": "1000"
    }),
    fetchChannel: async () =>
      createRootChannel({
        id: "watch-root",
        messageBatches: [
          [createMessage("1002", 2), createMessage("1001", 1)]
        ]
      }),
    messageIntakeService: {
      handle: async (message: Message<true>) => {
        handled.push(message.id);
      }
    } as unknown as MessageIntakeService,
    logger: createLogger()
  });

  await service.recoverPendingMessages();

  assert.deepEqual(handled, ["1001", "1002"]);
});

test("startup recovery replays active thread backlog using the thread cursor when present", async () => {
  const handled: string[] = [];
  const thread = createThreadChannel({
    id: "thread-1",
    messageBatches: [[createMessage("2002", 12), createMessage("2001", 11)]]
  });
  const service = new StartupMessageRecoveryService({
    watchLocations: [createWatchLocation()],
    store: createStore({
      "watch-root": "1000",
      "thread-1": "2000"
    }),
    fetchChannel: async () =>
      createRootChannel({
        id: "watch-root",
        activeThreads: [thread],
        messageBatches: []
      }),
    messageIntakeService: {
      handle: async (message: Message<true>) => {
        handled.push(message.id);
      }
    } as unknown as MessageIntakeService,
    logger: createLogger()
  });

  await service.recoverPendingMessages();

  assert.deepEqual(handled, ["2001", "2002"]);
  assert.deepEqual(thread.fetchCalls, ["2000"]);
});

test("startup recovery falls back to the root cursor for active threads without their own cursor", async () => {
  const thread = createThreadChannel({
    id: "thread-1",
    messageBatches: [[createMessage("3001", 21)]]
  });
  const service = new StartupMessageRecoveryService({
    watchLocations: [createWatchLocation()],
    store: createStore({
      "watch-root": "1500"
    }),
    fetchChannel: async () =>
      createRootChannel({
        id: "watch-root",
        activeThreads: [thread],
        messageBatches: []
      }),
    messageIntakeService: {
      handle: async () => {}
    } as unknown as MessageIntakeService,
    logger: createLogger()
  });

  await service.recoverPendingMessages();

  assert.deepEqual(thread.fetchCalls, ["1500"]);
});

function createWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "watch-root",
    mode: "url_watch",
    defaultScope: "server_public"
  };
}

function createStore(
  cursors: Record<string, string>
): SqliteStore {
  return {
    channelCursors: {
      get: (channelId: string) => {
        const messageId = cursors[channelId];
        if (!messageId) {
          return null;
        }
        return {
          channel_id: channelId,
          last_processed_message_id: messageId,
          updated_at: "2026-03-19T00:00:00.000Z"
        };
      }
    }
  } as SqliteStore;
}

function createRootChannel(input: {
  id: string;
  messageBatches: Message<true>[][];
  activeThreads?: AnyThreadChannel[];
}): TextChannel | NewsChannel {
  const batches = [...input.messageBatches];
  return {
    id: input.id,
    type: ChannelType.GuildText,
    messages: {
      fetch: async ({ after }: { after?: string }) => {
        void after;
        return createCollection(batches.shift() ?? []);
      }
    },
    threads: {
      fetchActive: async () => ({
        threads: createCollection(input.activeThreads ?? [])
      })
    }
  } as unknown as TextChannel;
}

function createThreadChannel(input: {
  id: string;
  messageBatches: Message<true>[][];
}): AnyThreadChannel & { fetchCalls: string[] } {
  const batches = [...input.messageBatches];
  const fetchCalls: string[] = [];
  return {
    id: input.id,
    messages: {
      fetch: async ({ after }: { after?: string }) => {
        fetchCalls.push(after ?? "");
        return createCollection(batches.shift() ?? []);
      }
    },
    fetchCalls
  } as unknown as AnyThreadChannel & { fetchCalls: string[] };
}

function createMessage(id: string, createdTimestamp: number): Message<true> {
  return {
    id,
    createdTimestamp
  } as Message<true>;
}

function createCollection<T extends { id: string }>(
  values: T[]
): Collection<string, T> {
  return new Collection(values.map((value) => [value.id, value]));
}

function createLogger() {
  return {
    debug: () => {},
    warn: () => {}
  };
}
