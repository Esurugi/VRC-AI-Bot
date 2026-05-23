import type {
  ChatBehavior,
  PlaceFeature,
  WatchLocationConfig,
  WatchMode
} from "./types.js";

const LEGACY_MODE_FEATURES: Record<WatchLocationConfig["mode"], PlaceFeature[]> = {
  url_watch: ["knowledge_ingest", "conversation"],
  chat: ["conversation"],
  admin_control: ["admin_override", "conversation"],
  forum_longform: ["forum_research", "conversation"]
};

export function resolvePlaceFeatures(
  watchLocation: WatchLocationConfig
): PlaceFeature[] {
  return watchLocation.features?.length
    ? dedupePlaceFeatures(watchLocation.features)
    : LEGACY_MODE_FEATURES[watchLocation.mode];
}

export function hasPlaceFeature(
  watchLocation: WatchLocationConfig,
  feature: PlaceFeature
): boolean {
  return resolvePlaceFeatures(watchLocation).includes(feature);
}

export function isForumResearchPlace(
  watchLocation: WatchLocationConfig
): boolean {
  return hasPlaceFeature(watchLocation, "forum_research");
}

export function isClearExplanationPlace(
  watchLocation: WatchLocationConfig
): boolean {
  return hasPlaceFeature(watchLocation, "clear_explanation");
}

export function isKnowledgeIngestPlace(
  watchLocation: WatchLocationConfig
): boolean {
  return hasPlaceFeature(watchLocation, "knowledge_ingest");
}

export function isConversationPlace(
  watchLocation: WatchLocationConfig
): boolean {
  return hasPlaceFeature(watchLocation, "conversation");
}

export function resolvePlaceChatBehavior(
  watchLocation: WatchLocationConfig
): ChatBehavior | null {
  if (watchLocation.chatBehavior !== undefined) {
    return watchLocation.chatBehavior;
  }

  const features = resolvePlaceFeatures(watchLocation);
  const isPlainConversation =
    features.length === 1 && features.includes("conversation");
  return isPlainConversation ? "ambient_room_chat" : null;
}

export function isAmbientConversationPlace(
  watchLocation: WatchLocationConfig
): boolean {
  return (
    isConversationPlace(watchLocation) &&
    !isKnowledgeIngestPlace(watchLocation) &&
    !isForumResearchPlace(watchLocation) &&
    !isClearExplanationPlace(watchLocation) &&
    !hasPlaceFeature(watchLocation, "admin_override") &&
    resolvePlaceChatBehavior(watchLocation) === "ambient_room_chat"
  );
}

function dedupePlaceFeatures(features: PlaceFeature[]): PlaceFeature[] {
  return [...new Set(features)];
}

export function inferLegacyWatchModeFromFeatures(
  features: PlaceFeature[]
): WatchMode {
  if (features.includes("admin_override")) {
    return "admin_control";
  }

  if (features.includes("forum_research")) {
    return "forum_longform";
  }

  if (features.includes("clear_explanation")) {
    return "chat";
  }

  if (features.includes("knowledge_ingest")) {
    return "url_watch";
  }

  return "chat";
}

export function normalizePlaceFeatures(features: PlaceFeature[]): PlaceFeature[] {
  return dedupePlaceFeatures(features);
}
