import type { Message } from "discord.js";
import type { Logger } from "pino";

import {
  buildMessageEnvelope,
  isEligibleMessage,
  resolveWatchLocation
} from "../../discord/message-utils.js";
import { resolveActorRole, resolveScope } from "../../discord/facts.js";
import type { AppConfig } from "../../domain/types.js";
import { OrderedMessageQueue } from "../../queue/ordered-message-queue.js";
import { ChatChannelCounterService } from "../chat/chat-channel-counter-service.js";
import {
  ChatEngagementPolicy,
  type ChatEngagementEvaluation,
  toChatEngagementFact
} from "../chat/chat-engagement-policy.js";
import { ChatRuntimeControlService } from "../chat/chat-runtime-control-service.js";
import { ForumThreadService } from "../forum/forum-thread-service.js";
import type { QueuedMessage } from "../types.js";
import { shouldShowProcessingReaction } from "./processing-visibility.js";

export class MessageIntakeService {
  constructor(
    private readonly config: AppConfig,
    private readonly queue: OrderedMessageQueue<QueuedMessage>,
    private readonly chatChannelCounterService: ChatChannelCounterService,
    private readonly chatEngagementPolicy: ChatEngagementPolicy,
    private readonly chatRuntimeControlService: ChatRuntimeControlService,
    private readonly forumThreadService: ForumThreadService,
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

    if (!isEligibleMessage(message)) {
      return;
    }

    const typedMessage = message as Message<true>;
    if (!this.forumThreadService.shouldHandleMessage(typedMessage, watchLocation)) {
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

    const envelope = buildMessageEnvelope(typedMessage, watchLocation);
    const actorRole = resolveActorRole(typedMessage, this.config.discordOwnerUserIds);
    const scope = resolveScope(typedMessage, watchLocation);

    const forumAlways = this.forumThreadService.shouldHandleEveryMessage({
      envelope,
      watchLocation
    });
    const engagement = forumAlways
      ? {
          decision: "always" as const,
          triggerKind: null,
          isDirectedToBot: false
        }
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
  if (ordinaryMessageCount % 5 !== 0) {
    return null;
  }

  return toChatEngagementFact({
    evaluation: input.engagement,
    ordinaryMessageCount
  });
}
