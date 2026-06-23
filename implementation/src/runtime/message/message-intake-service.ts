import type { Message } from "discord.js";
import type { Logger } from "pino";

import {
  buildMessageEnvelope,
  isEligibleMessage,
  resolveWatchLocation
} from "../../discord/message-utils.js";
import { resolveActorRole, resolveScope } from "../../discord/facts.js";
import type { AppConfig } from "../../domain/types.js";
import { isClearExplanationPlace } from "../../domain/place-features.js";
import { OrderedMessageQueue } from "../../queue/ordered-message-queue.js";
import { ChatChannelCounterService } from "../chat/chat-channel-counter-service.js";
import {
  ChatEngagementPolicy,
  type ChatEngagementEvaluation,
  toChatEngagementFact
} from "../chat/chat-engagement-policy.js";
import { RecentChatHistoryService } from "../chat/recent-chat-history-service.js";
import { ChatRuntimeControlService } from "../chat/chat-runtime-control-service.js";
import { FeatureThreadService } from "../thread/feature-thread-service.js";
import type { QueuedMessage } from "../types.js";
import { PlainTextAttachmentService } from "./plain-text-attachment-service.js";
import { shouldShowProcessingReaction } from "./processing-visibility.js";

export class MessageIntakeService {
  constructor(
    private readonly config: AppConfig,
    private readonly queue: OrderedMessageQueue<QueuedMessage>,
    private readonly chatChannelCounterService: ChatChannelCounterService,
    private readonly chatEngagementPolicy: ChatEngagementPolicy,
    private readonly chatRuntimeControlService: ChatRuntimeControlService,
    private readonly recentChatHistoryService: RecentChatHistoryService,
    private readonly featureThreadService: FeatureThreadService,
    private readonly plainTextAttachmentService: PlainTextAttachmentService,
    private readonly logger: Logger
  ) {}

  async handle(message: Message): Promise<void> {
    if (!message.inGuild()) {
      return;
    }

    const watchLocation = resolveWatchLocation(message, this.config.watchLocations);
    if (!watchLocation) {
      return;
    }

    this.recentChatHistoryService.observe(message);

    if (!isEligibleMessage(message)) {
      return;
    }

    const typedMessage = message as Message<true>;
    if (
      isClearExplanationPlace(watchLocation) &&
      !typedMessage.channel.isThread()
    ) {
      return;
    }

    const featureThreadHandling = await this.featureThreadService.evaluateMessage(
      typedMessage,
      watchLocation
    );
    if (featureThreadHandling.decision === "ignore") {
      return;
    }

    if (
      !this.chatRuntimeControlService.isEnabled({
        message: typedMessage,
        watchLocation
      })
    ) {
      return;
    }

    const effectiveContent =
      await this.plainTextAttachmentService.buildEffectiveContent(typedMessage);
    const envelope = buildMessageEnvelope(
      typedMessage,
      watchLocation,
      effectiveContent
    );
    const actorRole = resolveActorRole(typedMessage, this.config.discordOwnerUserIds);
    const scope = resolveScope(typedMessage, watchLocation);

    const engagement =
      featureThreadHandling.decision === "handle"
        ? featureThreadHandling.engagement
        : await this.chatEngagementPolicy.evaluate({
            message: typedMessage,
            envelope,
            watchLocation
          });

    if (engagement.decision === "ignore") {
      return;
    }

    const chatEngagement = resolveQueuedChatEngagement({
      engagement,
      channelId: typedMessage.channelId,
      ambientSparseInterval: this.config.runtime.ambientSparseInterval,
      increment: (channelId) => this.chatChannelCounterService.increment(channelId)
    });
    if (chatEngagement === null && engagement.decision === "sparse") {
      return;
    }

    const enqueued = this.queue.enqueue({
      messageId: typedMessage.id,
      orderingKey: typedMessage.channelId,
      source: "live",
      message: typedMessage,
      envelope,
      watchLocation,
      actorRole,
      scope,
      chatEngagement
    });

    if (
      enqueued &&
      shouldShowProcessingReaction({
        watchLocation,
        chatEngagement
      })
    ) {
      await this.tryAddProcessingReaction(typedMessage);
    }
  }

  private async tryAddProcessingReaction(message: Message<true>): Promise<void> {
    try {
      await message.react("👀");
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: message.id
        },
        "failed to add processing reaction"
      );
    }
  }
}

function resolveQueuedChatEngagement(input: {
  engagement: ChatEngagementEvaluation;
  channelId: string;
  ambientSparseInterval: number;
  increment: (channelId: string) => { ordinary_message_count?: number } | null;
}): ReturnType<typeof toChatEngagementFact> {
  if (input.engagement.triggerKind) {
    return toChatEngagementFact({ evaluation: input.engagement });
  }

  if (input.engagement.decision !== "sparse") {
    return null;
  }

  const counter = input.increment(input.channelId);
  const ordinaryMessageCount = counter?.ordinary_message_count ?? 0;
  if (ordinaryMessageCount % input.ambientSparseInterval !== 0) {
    return null;
  }

  return toChatEngagementFact({
    evaluation: input.engagement,
    ordinaryMessageCount
  });
}
