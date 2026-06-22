import { randomUUID } from "node:crypto";

import type {
  ActorRole,
  ChatEngagementFact,
  MessageEnvelope,
  RecentRoomEventFact,
  Scope,
  WatchLocationConfig
} from "../domain/types.js";
import {
  isKnowledgeIngestPlace,
  resolvePlaceChatBehavior,
  resolvePlaceFeatures
} from "../domain/place-features.js";
import { buildPublicSourceContext } from "../knowledge/public-source/source-resolver.js";
import type { OverrideContext } from "../override/types.js";
import type {
  HarnessRequest,
  HarnessTaskPhase,
  HarnessTaskKind,
  ThreadContextKind
} from "./contracts.js";

export function buildHarnessRequest(input: {
  actorRole: ActorRole;
  scope: Scope;
  watchLocation: WatchLocationConfig;
  envelope: MessageEnvelope;
  effectiveContentOverride?: string | null;
  taskKind: HarnessTaskKind;
  taskPhase?: HarnessTaskPhase;
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
  chatEngagement?: ChatEngagementFact | null;
  recentRoomEvents?: RecentRoomEventFact[];
  publicSourceFacts?: NonNullable<
    HarnessRequest["available_context"]["public_source_facts"]
  >;
  publicSourceFailures?: NonNullable<
    HarnessRequest["available_context"]["public_source_failures"]
  >;
  retryContext?:
    | {
        kind: "output_safety";
        retryCount: number;
        reason: string;
        allowedSources: string[];
        disallowedSources: string[];
      }
    | {
        kind: "knowledge_followup_non_silent";
        retryCount: number;
      }
    | null;
}): HarnessRequest {
  const {
    actorRole,
    scope,
    watchLocation,
    envelope,
    effectiveContentOverride = null,
    taskKind,
    taskPhase = "answer",
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
    discordRuntimeFactsPath = null,
    chatEngagement = null,
    recentRoomEvents = [],
    publicSourceFacts = [],
    publicSourceFailures = [],
    retryContext = null
  } = input;
  const publicSourceContext = buildPublicSourceContext({
    urls: envelope.urls,
    publicSourceFacts,
    publicSourceFailures
  });
  const isKnowledgePlace =
    isKnowledgeIngestPlace(watchLocation) ||
    threadContext.kind === "knowledge_thread" ||
    threadContext.kind === "missing_or_stale_knowledge_thread";
  const placeFeatures = resolvePlaceFeatures(watchLocation);
  const deliveryTriggerKind =
    chatEngagement?.is_directed_to_bot === true
      ? chatEngagement.trigger_kind === "direct_mention" ||
        chatEngagement.trigger_kind === "reply_to_bot"
        ? chatEngagement.trigger_kind
        : null
      : null;

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
      content: effectiveContentOverride ?? envelope.content,
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
      place_context: {
        features: placeFeatures,
        is_knowledge_place: isKnowledgePlace
      },
      delivery_context: {
        is_bot_directed: chatEngagement?.is_directed_to_bot ?? false,
        bot_directed_trigger_kind: deliveryTriggerKind
      },
      discord_runtime_facts_path: discordRuntimeFactsPath,
      approved_public_urls: publicSourceContext.approved_public_urls,
      public_source_resources: publicSourceContext.public_source_resources,
      readable_public_url_candidates:
        publicSourceContext.readable_public_url_candidates,
      public_source_facts: publicSourceContext.public_source_facts,
      public_source_failures: publicSourceContext.public_source_failures,
      blocked_urls: publicSourceContext.blocked_urls,
      chat_engagement: chatEngagement,
      recent_room_events: recentRoomEvents,
      chat_behavior: resolvePlaceChatBehavior(watchLocation)
    },
    task: {
      kind: taskKind,
      phase: taskPhase,
      retry_context:
        retryContext?.kind === "output_safety"
          ? {
              kind: "output_safety",
              retry_count: retryContext.retryCount,
              reason: retryContext.reason,
              allowed_sources: retryContext.allowedSources,
              disallowed_sources: retryContext.disallowedSources
            }
          : retryContext?.kind === "knowledge_followup_non_silent"
            ? {
                kind: "knowledge_followup_non_silent",
                retry_count: retryContext.retryCount
              }
            : null
    }
  };
}
