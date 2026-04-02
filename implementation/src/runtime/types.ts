import type { Message } from "discord.js";

import type { FailureStage } from "../app/failure-classifier.js";
import type {
  ActorRole,
  ChatEngagementFact,
  MessageEnvelope,
  Scope,
  WatchLocationConfig
} from "../domain/types.js";
import type { HarnessRunner } from "../harness/harness-runner.js";
import type { AppConfig } from "../domain/types.js";

export type QueuedMessage = {
  messageId: string;
  orderingKey: string;
  source: "live" | "retry";
  message: Message<true>;
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
  actorRole: ActorRole;
  scope: Scope;
  chatEngagement: ChatEngagementFact | null;
};

export type FailureReplyTarget = {
  channelId: string;
  threadId: string | null;
};

export type StageFailureInput = {
  stage: FailureStage;
  error: unknown;
  replyTarget: FailureReplyTarget;
};

export type RoutedHarnessMessage = Awaited<ReturnType<HarnessRunner["routeMessage"]>>;

export function buildSamePlaceReplyTarget(item: QueuedMessage): FailureReplyTarget {
  return {
    channelId: item.message.channelId,
    threadId: item.message.channel.isThread() ? item.message.channel.id : null
  };
}

export function buildRetrySchedulerEnvelope(input: {
  guildId: string;
  messageChannelId: string;
  messageId: string;
  replyThreadId: string | null;
}): MessageEnvelope {
  return {
    guildId: input.guildId,
    channelId: input.messageChannelId,
    messageId: input.messageId,
    authorId: "retry-scheduler",
    placeType: input.replyThreadId ? "public_thread" : "chat_channel",
    rawPlaceType: input.replyThreadId ? "public_thread" : "chat_channel",
    content: "",
    urls: [],
    receivedAt: new Date().toISOString()
  };
}

export function resolveRetryWatchLocation(
  config: AppConfig,
  input: {
    guildId: string;
    watchChannelId: string;
    mode: WatchLocationConfig["mode"];
  }
): WatchLocationConfig {
  const resolved = config.watchLocations.find(
    (location) =>
      location.guildId === input.guildId &&
      location.channelId === input.watchChannelId &&
      location.mode === input.mode
  );
  if (!resolved) {
    throw new Error(
      `watch location not found for retry job: ${input.guildId}:${input.watchChannelId}:${input.mode}`
    );
  }
  return resolved;
}
