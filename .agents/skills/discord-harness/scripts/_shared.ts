import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

type ParsedArgs = {
  factsPath: string;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let factsPath = "";

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }
    if (token === "--facts") {
      factsPath = args.shift() ?? "";
      continue;
    }
    if (!factsPath) {
      factsPath = token;
    }
  }

  if (!factsPath) {
    throw new Error("Missing facts path. Use --facts <path>.");
  }

  return {
    factsPath: path.resolve(process.cwd(), factsPath)
  };
}

export function readJsonFile(filePath: string): JsonRecord {
  const raw = fs.readFileSync(filePath, "utf8");
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Facts file must contain a JSON object.");
  }
  return value as JsonRecord;
}

function getRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function normalizeFactsEnvelope(input: JsonRecord): JsonRecord {
  const source = getRecord(input.source) ?? {};
  const actor = getRecord(input.actor) ?? getRecord(input.user) ?? {};
  const place = getRecord(input.place) ?? {};
  const message = getRecord(input.message) ?? {};
  const availableContext =
    getRecord(input.available_context) ??
    getRecord(input.availableContext) ??
    {};
  const threadContext =
    getRecord(availableContext.thread_context) ??
    getRecord(availableContext.threadContext) ??
    getRecord(input.thread_context) ??
    getRecord(input.threadContext) ??
    {};
  const capabilities = getRecord(input.capabilities) ?? {};
  const channelLineage =
    getRecord(input.channel_lineage) ??
    getRecord(input.channelLineage) ??
    {
      guild_id: getString(place.guild_id),
      channel_id: getString(place.channel_id),
      root_channel_id: getString(place.root_channel_id),
      thread_id: getString(place.thread_id),
      reply_thread_id: getString(threadContext.reply_thread_id)
    };

  return {
    request_id: getString(input.request_id) ?? getString(input.requestId),
    source: {
      adapter: getString(source.adapter),
      event: getString(source.event)
    },
    actor: {
      user_id: getString(actor.user_id) ?? getString(actor.userId) ?? getString(actor.id),
      role: getString(actor.role)
    },
    message: {
      id: getString(message.id) ?? getString(message.message_id) ?? getString(message.messageId),
      content: getString(message.content),
      urls: getStringArray(message.urls),
      created_at: getString(message.created_at) ?? getString(message.createdAt)
    },
    place: {
      guild_id: getString(place.guild_id) ?? getString(place.guildId),
      channel_id: getString(place.channel_id) ?? getString(place.channelId),
      root_channel_id: getString(place.root_channel_id) ?? getString(place.rootChannelId),
      thread_id: getString(place.thread_id) ?? getString(place.threadId),
      mode: getString(place.mode),
      place_type: getString(place.place_type) ?? getString(place.placeType),
      scope: getString(place.scope)
    },
    thread_context: {
      kind: getString(threadContext.kind),
      source_message_id:
        getString(threadContext.source_message_id) ?? getString(threadContext.sourceMessageId),
      known_source_urls:
        getStringArray(threadContext.known_source_urls).length > 0
          ? getStringArray(threadContext.known_source_urls)
          : getStringArray(threadContext.knownSourceUrls),
      reply_thread_id:
        getString(threadContext.reply_thread_id) ?? getString(threadContext.replyThreadId),
      root_channel_id:
        getString(threadContext.root_channel_id) ?? getString(threadContext.rootChannelId)
    },
    channel_lineage: {
      guild_id: getString(channelLineage.guild_id) ?? getString(channelLineage.guildId),
      channel_id: getString(channelLineage.channel_id) ?? getString(channelLineage.channelId),
      root_channel_id:
        getString(channelLineage.root_channel_id) ?? getString(channelLineage.rootChannelId),
      thread_id: getString(channelLineage.thread_id) ?? getString(channelLineage.threadId),
      reply_thread_id:
        getString(channelLineage.reply_thread_id) ?? getString(channelLineage.replyThreadId)
    },
    capabilities: {
      allow_external_fetch:
        capabilities.allow_external_fetch === true || capabilities.allowExternalFetch === true,
      allow_knowledge_write:
        capabilities.allow_knowledge_write === true || capabilities.allowKnowledgeWrite === true,
      allow_moderation:
        capabilities.allow_moderation === true || capabilities.allowModeration === true
    },
    available_context: {
      fetchable_public_urls:
        getStringArray(availableContext.fetchable_public_urls).length > 0
          ? getStringArray(availableContext.fetchable_public_urls)
          : getStringArray(availableContext.fetchablePublicUrls),
      blocked_urls:
        getStringArray(availableContext.blocked_urls).length > 0
          ? getStringArray(availableContext.blocked_urls)
          : getStringArray(availableContext.blockedUrls),
      discord_runtime_facts_path:
        getString(availableContext.discord_runtime_facts_path) ??
        getString(availableContext.discordRuntimeFactsPath)
    }
  };
}

export function loadFacts(argv: string[]): JsonRecord {
  const { factsPath } = parseArgs(argv);
  return normalizeFactsEnvelope(readJsonFile(factsPath));
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
