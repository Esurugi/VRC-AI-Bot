import { randomUUID } from "node:crypto";

import type {
  ActorRole,
  MessageEnvelope,
  Scope,
  WatchLocationConfig
} from "../domain/types.js";
import type { OverrideContext } from "../override/types.js";
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
  allowExternalFetch?: boolean;
  allowKnowledgeWrite?: boolean;
  allowModeration?: boolean;
  overrideContext?: OverrideContext;
  discordRuntimeFactsPath?: string | null;
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
    allowExternalFetch = false,
    allowKnowledgeWrite = false,
    allowModeration = false,
    overrideContext = {
      active: false,
      sameActor: false,
      startedBy: null,
      startedAt: null,
      flags: {
        allowPlaywrightHeaded: false,
        allowPlaywrightPersistent: false,
        allowPromptInjectionTest: false,
        suspendViolationCounterForCurrentThread: false,
        allowExternalFetchInPrivateContextWithoutPrivateTerms: false
      }
    },
    discordRuntimeFactsPath = null
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
      allow_external_fetch: allowExternalFetch,
      allow_knowledge_write: allowKnowledgeWrite,
      allow_moderation: allowModeration
    },
    override_context: {
      active: overrideContext.active,
      same_actor: overrideContext.sameActor,
      started_by: overrideContext.startedBy,
      started_at: overrideContext.startedAt,
      flags: {
        allow_playwright_headed: overrideContext.flags.allowPlaywrightHeaded,
        allow_playwright_persistent: overrideContext.flags.allowPlaywrightPersistent,
        allow_prompt_injection_test: overrideContext.flags.allowPromptInjectionTest,
        suspend_violation_counter_for_current_thread:
          overrideContext.flags.suspendViolationCounterForCurrentThread,
        allow_external_fetch_in_private_context_without_private_terms:
          overrideContext.flags.allowExternalFetchInPrivateContextWithoutPrivateTerms
      }
    },
    available_context: {
      thread_context: {
        kind: threadContext.kind,
        source_message_id: threadContext.sourceMessageId,
        known_source_urls: threadContext.knownSourceUrls,
        reply_thread_id: threadContext.replyThreadId,
        root_channel_id: threadContext.rootChannelId
      },
      discord_runtime_facts_path: discordRuntimeFactsPath,
      fetchable_public_urls: fetchablePublicUrls,
      blocked_urls: blockedUrls
    },
    task: {
      kind: taskKind
    }
  };
}
