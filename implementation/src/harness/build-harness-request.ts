import { randomUUID } from "node:crypto";

import type {
  ActorRole,
  MessageEnvelope,
  Scope,
  WatchLocationConfig
} from "../domain/types.js";
import { isAllowedPublicHttpUrl } from "../playwright/url-policy.js";
import type {
  HarnessRequest,
  HarnessTaskKind,
  ThreadContextKind
} from "./contracts.js";

export function buildHarnessRequest(input: {
  actorRole: ActorRole;
  scope: Scope;
  watchLocation: WatchLocationConfig;
  envelope: MessageEnvelope;
  taskKind: HarnessTaskKind;
  threadContext?: {
    kind: ThreadContextKind;
    sourceMessageId: string | null;
    knownSourceUrls: string[];
    replyThreadId: string | null;
    rootChannelId: string;
  };
  allowThreadCreate?: boolean;
  allowExternalFetch?: boolean;
  allowKnowledgeWrite?: boolean;
  allowModeration?: boolean;
}): HarnessRequest {
  const {
    actorRole,
    scope,
    watchLocation,
    envelope,
    taskKind,
    threadContext = {
      kind: "root_channel",
      sourceMessageId: null,
      knownSourceUrls: [],
      replyThreadId: null,
      rootChannelId: watchLocation.channelId
    },
    allowThreadCreate = false,
    allowExternalFetch = false,
    allowKnowledgeWrite = false,
    allowModeration = false
  } = input;
  const fetchablePublicUrls: string[] = [];
  const blockedUrls: string[] = [];

  for (const url of envelope.urls) {
    if (isAllowedPublicHttpUrl(url)) {
      fetchablePublicUrls.push(url);
      continue;
    }
    blockedUrls.push(url);
  }

  return {
    request_id: randomUUID(),
    source: {
      adapter: "discord",
      event: "message_create"
    },
    actor: {
      user_id: envelope.authorId,
      role: actorRole
    },
    place: {
      guild_id: envelope.guildId,
      channel_id: envelope.channelId,
      root_channel_id: watchLocation.channelId,
      thread_id: envelope.placeType.endsWith("thread") ? envelope.channelId : null,
      mode: watchLocation.mode,
      place_type: envelope.placeType,
      scope
    },
    message: {
      id: envelope.messageId,
      content: envelope.content,
      urls: envelope.urls,
      created_at: envelope.receivedAt
    },
    capabilities: {
      allow_thread_create: allowThreadCreate,
      allow_external_fetch: allowExternalFetch,
      allow_knowledge_write: allowKnowledgeWrite,
      allow_moderation: allowModeration
    },
    available_context: {
      thread_context: {
        kind: threadContext.kind,
        source_message_id: threadContext.sourceMessageId,
        known_source_urls: threadContext.knownSourceUrls,
        reply_thread_id: threadContext.replyThreadId,
        root_channel_id: threadContext.rootChannelId
      },
      fetchable_public_urls: fetchablePublicUrls,
      blocked_urls: blockedUrls
    },
    task: {
      kind: taskKind
    }
  };
}
