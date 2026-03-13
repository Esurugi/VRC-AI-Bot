import type { Message } from "discord.js";

import type { MessageEnvelope, WatchLocationConfig } from "../../domain/types.js";

export type ChatEngagementDecision = "always" | "sparse" | "ignore";

export type ChatEngagementFacts = {
  message: Message<true>;
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
};

export class ChatEngagementPolicy {
  async evaluate(input: ChatEngagementFacts): Promise<ChatEngagementDecision> {
    if (input.watchLocation.mode !== "chat") {
      return "always";
    }

    if (
      input.message.mentions.has(input.message.client.user?.id ?? "") ||
      (await isReplyToBot(input.message)) ||
      containsQuestionMarker(input.envelope.content)
    ) {
      return "always";
    }

    return "sparse";
  }
}

async function isReplyToBot(message: Message<true>): Promise<boolean> {
  if (!message.reference?.messageId) {
    return false;
  }

  if (message.mentions.repliedUser?.id === message.client.user?.id) {
    return true;
  }

  try {
    const referenced = await message.fetchReference();
    return referenced.author.id === message.client.user?.id;
  } catch {
    return false;
  }
}

function containsQuestionMarker(content: string): boolean {
  return content.includes("?") || content.includes("？");
}
