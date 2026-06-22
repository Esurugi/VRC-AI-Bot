import type { Message } from "discord.js";

import type { ChatEngagementEvaluation } from "./chat-engagement-types.js";

export async function resolveBotDirectedEngagement(input: {
  message: Message<true>;
  botUserId?: string | undefined;
}): Promise<ChatEngagementEvaluation | null> {
  if (
    input.botUserId !== undefined &&
    input.message.mentions.users.has(input.botUserId)
  ) {
    return {
      decision: "always",
      triggerKind: "direct_mention",
      isDirectedToBot: true
    };
  }

  if (await isReplyToBot(input.message)) {
    return {
      decision: "always",
      triggerKind: "reply_to_bot",
      isDirectedToBot: true
    };
  }

  return null;
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
