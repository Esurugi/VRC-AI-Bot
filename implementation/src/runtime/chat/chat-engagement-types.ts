import type { Message } from "discord.js";

import type {
  ChatEngagementTriggerKind,
  MessageEnvelope,
  WatchLocationConfig
} from "../../domain/types.js";

export type ChatEngagementDecision = "always" | "sparse" | "ignore";
export type DirectedChatTriggerKind = Exclude<
  ChatEngagementTriggerKind,
  "question_marker" | "sparse_periodic" | "ambient_room"
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
