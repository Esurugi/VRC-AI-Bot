import type { Message } from "discord.js";

import type {
  ChatRuntimeControlsConfig,
  WatchLocationConfig
} from "../../domain/types.js";

export class ChatRuntimeControlService {
  constructor(private readonly controls: ChatRuntimeControlsConfig | null | undefined) {}

  isEnabled(input: {
    message: Message<true>;
    watchLocation: WatchLocationConfig;
  }): boolean {
    if (input.watchLocation.mode !== "chat") {
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
