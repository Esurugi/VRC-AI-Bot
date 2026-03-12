import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  ChannelType,
  type Message,
  type ThreadChannel
} from "discord.js";

import type {
  ActorRole,
  Scope,
  WatchLocationConfig
} from "../domain/types.js";

export type DiscordRuntimeSnapshot = {
  version: 1;
  generated_at: string;
  message: {
    id: string;
    url: string;
    author_id: string;
    author_username: string;
    author_display_name: string | null;
    created_at: string;
  };
  actor: {
    role: ActorRole;
  };
  watch: {
    mode: WatchLocationConfig["mode"];
    default_scope: Scope;
    resolved_scope: Scope;
  };
  guild: {
    id: string;
    name: string;
  };
  current_place: {
    id: string;
    name: string | null;
    type: string;
    is_thread: boolean;
  };
  root_channel: {
    id: string;
    name: string | null;
    type: string;
  };
  thread: {
    id: string;
    name: string;
    parent_id: string | null;
    parent_name: string | null;
    archived: boolean;
    locked: boolean;
    auto_archive_duration: number | null;
  } | null;
};

export function writeDiscordRuntimeSnapshot(input: {
  message: Message<true>;
  watchLocation: WatchLocationConfig;
  actorRole: ActorRole;
  scope: Scope;
  requestId: string;
  projectRoot?: string;
}): { snapshotPath: string; snapshot: DiscordRuntimeSnapshot } {
  const projectRoot = input.projectRoot ?? process.cwd();
  const snapshotPath = resolve(
    projectRoot,
    ".tmp",
    "discord-runtime",
    `${input.requestId}.json`
  );
  const snapshot = buildDiscordRuntimeSnapshot(input);

  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  return {
    snapshotPath,
    snapshot
  };
}

export function readDiscordRuntimeSnapshot(path: string): DiscordRuntimeSnapshot {
  return JSON.parse(readFileSync(path, "utf8")) as DiscordRuntimeSnapshot;
}

function buildDiscordRuntimeSnapshot(input: {
  message: Message<true>;
  watchLocation: WatchLocationConfig;
  actorRole: ActorRole;
  scope: Scope;
}): DiscordRuntimeSnapshot {
  const { message, watchLocation, actorRole, scope } = input;
  const currentPlaceName = "name" in message.channel ? message.channel.name : null;
  const thread = message.channel.isThread() ? buildThreadFacts(message.channel) : null;
  const rootChannel = message.channel.isThread() ? message.channel.parent : message.channel;

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    message: {
      id: message.id,
      url: message.url,
      author_id: message.author.id,
      author_username: message.author.username,
      author_display_name: message.member?.displayName ?? null,
      created_at: message.createdAt.toISOString()
    },
    actor: {
      role: actorRole
    },
    watch: {
      mode: watchLocation.mode,
      default_scope: watchLocation.defaultScope,
      resolved_scope: scope
    },
    guild: {
      id: message.guildId,
      name: message.guild.name
    },
    current_place: {
      id: message.channel.id,
      name: currentPlaceName,
      type: ChannelType[message.channel.type] ?? String(message.channel.type),
      is_thread: message.channel.isThread()
    },
    root_channel: {
      id: rootChannel?.id ?? watchLocation.channelId,
      name: rootChannel && "name" in rootChannel ? rootChannel.name : null,
      type:
        rootChannel === null || rootChannel === undefined
          ? "unknown"
          : ChannelType[rootChannel.type] ?? String(rootChannel.type)
    },
    thread
  };
}

function buildThreadFacts(channel: ThreadChannel): DiscordRuntimeSnapshot["thread"] {
  return {
    id: channel.id,
    name: channel.name,
    parent_id: channel.parentId,
    parent_name: channel.parent?.name ?? null,
    archived: channel.archived === true,
    locked: channel.locked === true,
    auto_archive_duration: channel.autoArchiveDuration ?? null
  };
}

