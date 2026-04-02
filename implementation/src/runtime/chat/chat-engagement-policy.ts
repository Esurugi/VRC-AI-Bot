import type { Message } from "discord.js";

import type {
  ChatEngagementFact,
  ChatEngagementTriggerKind,
  MessageEnvelope,
  WatchLocationConfig
} from "../../domain/types.js";
import {
  isAmbientRoomChat
} from "../../domain/response-boundary.js";

export type ChatEngagementDecision = "always" | "sparse" | "ignore";
export type DirectedChatTriggerKind = Exclude<
  ChatEngagementTriggerKind,
  "sparse_periodic" | "ambient_room"
>;

export type ChatEngagementFacts = {
  message: Message<true>;
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
};

export type ChatEngagementEvaluation = {
  decision: ChatEngagementDecision;
  triggerKind: ChatEngagementTriggerKind | null;
  isDirectedToBot: boolean;
};

export class ChatEngagementPolicy {
  async evaluate(input: ChatEngagementFacts): Promise<ChatEngagementEvaluation> {
    const botUserId = input.message.client.user?.id;

    if (input.watchLocation.mode === "url_watch") {
      if (
        input.envelope.placeType.endsWith("thread") ||
        input.envelope.urls.length > 0
      ) {
        return {
          decision: "always",
          triggerKind: null,
          isDirectedToBot: false
        };
      }

      const directed = await resolveExplicitBotDirectedEvaluation({
        message: input.message,
        botUserId
      });
      if (directed) {
        return directed;
      }

      return {
        decision: "ignore",
        triggerKind: null,
        isDirectedToBot: false
      };
    }

    if (input.watchLocation.mode !== "chat") {
      return {
        decision: "always",
        triggerKind: null,
        isDirectedToBot: false
      };
    }

    const directed = await resolveExplicitBotDirectedEvaluation({
      message: input.message,
      botUserId
    });
    if (directed) {
      return directed;
    }

    if (isAmbientRoomChat(input.watchLocation)) {
      if (containsQuestionMarker(input.envelope.content)) {
        return {
          decision: "always",
          triggerKind: "ambient_room",
          isDirectedToBot: false
        };
      }

      return {
        decision: "sparse",
        triggerKind: null,
        isDirectedToBot: false
      };
    }

    if (containsQuestionMarker(input.envelope.content)) {
      return {
        decision: "always",
        triggerKind: "question_marker",
        isDirectedToBot: true
      };
    }

    return {
      decision: "sparse",
      triggerKind: null,
      isDirectedToBot: false
    };
  }
}

export function toChatEngagementFact(input: {
  evaluation: ChatEngagementEvaluation;
  ordinaryMessageCount?: number | null;
}): ChatEngagementFact | null {
  if (input.evaluation.decision === "ignore") {
    return null;
  }

  if (input.evaluation.triggerKind !== null) {
    return {
      trigger_kind: input.evaluation.triggerKind,
      is_directed_to_bot: input.evaluation.isDirectedToBot,
      sparse_ordinal: null,
      ordinary_message_count: null
    };
  }

  if (input.evaluation.decision !== "sparse") {
    return null;
  }

  return {
    trigger_kind: "sparse_periodic",
    is_directed_to_bot: false,
    sparse_ordinal: input.ordinaryMessageCount ?? null,
    ordinary_message_count: input.ordinaryMessageCount ?? null
  };
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

async function resolveExplicitBotDirectedEvaluation(input: {
  message: Message<true>;
  botUserId: string | undefined;
}): Promise<ChatEngagementEvaluation | null> {
  if (input.botUserId !== undefined && input.message.mentions.users.has(input.botUserId)) {
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
