import type {
  ChatEngagementFact,
  MessageEnvelope,
  WatchLocationConfig
} from "./types.js";
import {
  isAmbientConversationPlace,
  isKnowledgeIngestPlace
} from "./place-features.js";

export function isKnowledgePlace(watchLocation: WatchLocationConfig): boolean {
  return isKnowledgeIngestPlace(watchLocation);
}

export function isThreadEnvelope(envelope: MessageEnvelope): boolean {
  return envelope.placeType.endsWith("thread");
}

export function hasSharedSourceEvidence(envelope: MessageEnvelope): boolean {
  return envelope.urls.length > 0;
}

export function isKnowledgePlaceRootShare(input: {
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
}): boolean {
  return (
    isKnowledgePlace(input.watchLocation) &&
    !isThreadEnvelope(input.envelope) &&
    hasSharedSourceEvidence(input.envelope)
  );
}

export function isAmbientRoomChat(watchLocation: WatchLocationConfig): boolean {
  return isAmbientConversationPlace(watchLocation);
}

export function isExplicitBotDirectedEngagement(
  chatEngagement: ChatEngagementFact | null
): boolean {
  const triggerKind = chatEngagement?.trigger_kind ?? null;
  return triggerKind === "direct_mention" || triggerKind === "reply_to_bot";
}
