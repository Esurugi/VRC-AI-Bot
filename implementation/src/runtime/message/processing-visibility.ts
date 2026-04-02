import type { AppConfig } from "../../domain/types.js";
import type { QueuedMessage } from "../types.js";

type ProcessingVisibilityInput = {
  watchLocation: AppConfig["watchLocations"][number];
  chatEngagement: QueuedMessage["chatEngagement"];
};

export function shouldShowProcessingUi(input: ProcessingVisibilityInput): boolean {
  if (input.watchLocation.mode !== "chat") {
    return true;
  }

  const triggerKind = input.chatEngagement?.trigger_kind ?? null;
  return (
    triggerKind === "direct_mention" ||
    triggerKind === "reply_to_bot" ||
    triggerKind === "question_marker"
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
