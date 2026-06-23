import type { Message } from "discord.js";

import type {
  ChatRuntimeControlsConfig,
  WatchLocationConfig
} from "../../domain/types.js";
import {
  hasPlaceFeature,
  isConversationPlace,
  resolvePlaceChatBehavior
} from "../../domain/place-features.js";

export class ChatRuntimeControlService {
  constructor(private readonly controls: ChatRuntimeControlsConfig | null | undefined) {}

  isEnabled(input: {
    message: Message<true>;
    watchLocation: WatchLocationConfig;
  }): boolean {
    if (!isChatRuntimeControlledPlace(input.watchLocation)) {
      return true;
    }

    if (!this.controls) {
      return true;
    }

    if (!this.controls.enabled) {
      return false;
    }

    return this.controls.enabledChannelIds.includes(resolveRootChannelId(input.message));
  }
}

function resolveRootChannelId(message: Message<true>): string {
  return message.channel.isThread() ? (message.channel.parentId ?? message.channel.id) : message.channelId;
}

function isChatRuntimeControlledPlace(
  watchLocation: WatchLocationConfig
): boolean {
  return (
    isConversationPlace(watchLocation) &&
    !hasPlaceFeature(watchLocation, "knowledge_ingest") &&
    !hasPlaceFeature(watchLocation, "admin_override") &&
    !hasPlaceFeature(watchLocation, "forum_research") &&
    !hasPlaceFeature(watchLocation, "clear_explanation") &&
    !hasPlaceFeature(watchLocation, "question_gateway") &&
    resolvePlaceChatBehavior(watchLocation) !== null
  );
}
