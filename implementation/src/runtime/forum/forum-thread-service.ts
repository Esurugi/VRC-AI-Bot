import type { Message } from "discord.js";

import type { MessageEnvelope, WatchLocationConfig } from "../../domain/types.js";

export class ForumThreadService {
  shouldHandleMessage(
    message: Message<true>,
    watchLocation: WatchLocationConfig
  ): boolean {
    if (watchLocation.mode !== "forum_longform") {
      return true;
    }

    return message.channel.isThread();
  }

  shouldHandleEveryMessage(input: {
    envelope: MessageEnvelope;
    watchLocation: WatchLocationConfig;
  }): boolean {
    return (
      input.watchLocation.mode === "forum_longform" &&
      input.envelope.placeType === "forum_post_thread"
    );
  }
}
