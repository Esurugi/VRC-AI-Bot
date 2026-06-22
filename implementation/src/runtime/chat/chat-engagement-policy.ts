import type { ChatEngagementFact } from "../../domain/types.js";
import {
  isKnowledgePlaceRootShare,
  isThreadEnvelope
} from "../../domain/response-boundary.js";
import {
  isAmbientConversationPlace,
  isConversationPlace,
  isKnowledgeIngestPlace,
  resolvePlaceChatBehavior
} from "../../domain/place-features.js";
import { resolveBotDirectedEngagement } from "./bot-directed-engagement.js";
import type {
  ChatEngagementEvaluation,
  ChatEngagementFacts
} from "./chat-engagement-types.js";
export type {
  ChatEngagementDecision,
  ChatEngagementEvaluation,
  ChatEngagementFacts,
  DirectedChatTriggerKind
} from "./chat-engagement-types.js";

export class ChatEngagementPolicy {
  async evaluate(input: ChatEngagementFacts): Promise<ChatEngagementEvaluation> {
    const botUserId = input.message.client.user?.id;

    if (isKnowledgeIngestPlace(input.watchLocation)) {
      if (
        isKnowledgePlaceRootShare({
          envelope: input.envelope,
          watchLocation: input.watchLocation
        })
      ) {
        return {
          decision: "always",
          triggerKind: null,
          isDirectedToBot: false
        };
      }

      const directed = await resolveBotDirectedEngagement({
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

    if (!isConversationPlace(input.watchLocation)) {
      return {
        decision: "always",
        triggerKind: null,
        isDirectedToBot: false
      };
    }

    const directed = await resolveBotDirectedEngagement({
      message: input.message,
      botUserId
    });
    if (directed) {
      return directed;
    }

    const chatBehavior = resolvePlaceChatBehavior(input.watchLocation);
    if (chatBehavior === null) {
      return {
        decision: "always",
        triggerKind: null,
        isDirectedToBot: false
      };
    }

    if (chatBehavior !== null && isThreadEnvelope(input.envelope)) {
      return {
        decision: "ignore",
        triggerKind: null,
        isDirectedToBot: false
      };
    }

    if (isAmbientConversationPlace(input.watchLocation)) {
      return {
        decision: "sparse",
        triggerKind: null,
        isDirectedToBot: false
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
