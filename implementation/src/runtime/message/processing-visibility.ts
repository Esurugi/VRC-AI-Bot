import type { AppConfig } from "../../domain/types.js";
import {
  isConversationPlace,
  resolvePlaceChatBehavior
} from "../../domain/place-features.js";
import type { QueuedMessage } from "../types.js";

type ProcessingVisibilityInput = {
  watchLocation: AppConfig["watchLocations"][number];
  chatEngagement: QueuedMessage["chatEngagement"];
};

export function shouldShowProcessingUi(input: ProcessingVisibilityInput): boolean {
  const chatBehavior = resolvePlaceChatBehavior(input.watchLocation);
  if (!isConversationPlace(input.watchLocation) || chatBehavior === null) {
    return true;
  }

  const triggerKind = input.chatEngagement?.trigger_kind ?? null;
  return (
    triggerKind === "direct_mention" ||
    triggerKind === "reply_to_bot"
  );
}

export function shouldShowProcessingReaction(
  input: ProcessingVisibilityInput
): boolean {
  return shouldShowProcessingUi(input);
}

export function shouldShowTypingIndicator(
  input: ProcessingVisibilityInput
): boolean {
  return shouldShowProcessingUi(input);
}
