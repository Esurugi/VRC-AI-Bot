import type { Message } from "discord.js";

import { hasPlaceFeature } from "../../domain/place-features.js";
import type { WatchLocationConfig } from "../../domain/types.js";
import type { ChatEngagementEvaluation } from "../chat/chat-engagement-types.js";
import { resolveBotDirectedEngagement } from "../chat/bot-directed-engagement.js";

export type FeatureThreadHandling =
  | {
      decision: "pass";
    }
  | {
      decision: "ignore";
    }
  | {
      decision: "handle";
      engagement: ChatEngagementEvaluation;
    };

export class FeatureThreadService {
  async evaluateMessage(
    message: Message<true>,
    watchLocation: WatchLocationConfig
  ): Promise<FeatureThreadHandling> {
    if (!usesDedicatedThreadEngagement(watchLocation)) {
      return {
        decision: "pass"
      };
    }

    if (!message.channel.isThread()) {
      return {
        decision: "ignore"
      };
    }

    if (await isThreadStarterMessage(message)) {
      return {
        decision: "handle",
        engagement: {
          decision: "always",
          triggerKind: null,
          isDirectedToBot: false
        }
      };
    }

    const directed = await resolveBotDirectedEngagement({
      message,
      botUserId: message.client.user?.id
    });
    if (directed !== null) {
      return {
        decision: "handle",
        engagement: directed
      };
    }

    return {
      decision: "ignore"
    };
  }

  async shouldHandleMessage(
    message: Message<true>,
    watchLocation: WatchLocationConfig
  ): Promise<boolean> {
    const handling = await this.evaluateMessage(message, watchLocation);
    return handling.decision !== "ignore";
  }
}

function usesDedicatedThreadEngagement(
  watchLocation: WatchLocationConfig
): boolean {
  return (
    hasPlaceFeature(watchLocation, "forum_research") ||
    hasPlaceFeature(watchLocation, "clear_explanation")
  );
}

async function isThreadStarterMessage(message: Message<true>): Promise<boolean> {
  if (!message.channel.isThread()) {
    return false;
  }

  if (message.id === message.channel.id) {
    return true;
  }

  const starter = await message.channel.fetchStarterMessage().catch(() => null);
  return starter?.id === message.id;
}
