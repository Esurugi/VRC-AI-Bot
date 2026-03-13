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
import { ChatEngagementPolicy } from "../chat/chat-engagement-policy.js";
import { ChatRuntimeControlService } from "../chat/chat-runtime-control-service.js";
import { ForumThreadService } from "../forum/forum-thread-service.js";
import type { QueuedMessage } from "../types.js";

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
      ? "always"
      : await this.chatEngagementPolicy.evaluate({
          message: typedMessage,
          envelope,
          watchLocation
        });

    if (engagement === "ignore") {
      return;
    }

    if (engagement === "sparse") {
      const counter = this.chatChannelCounterService.increment(typedMessage.channelId);
      if ((counter?.ordinary_message_count ?? 0) % 5 !== 0) {
        return;
      }
    }

    const enqueued = this.queue.enqueue({
      messageId: typedMessage.id,
      orderingKey: typedMessage.channelId,
      source: "live",
      message: typedMessage,
      envelope,
      watchLocation,
      actorRole,
      scope
    });

    if (enqueued) {
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
