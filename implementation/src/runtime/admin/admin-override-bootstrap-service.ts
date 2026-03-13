import { ChannelType, type AnyThreadChannel } from "discord.js";
import type { Logger } from "pino";

import { buildFailureNotice } from "../../app/replies.js";
import type { FailureClassifier, FailureStage } from "../../app/failure-classifier.js";
import type {
  BotModerationIntegration,
  PostResponseModerationInput
} from "../../app/moderation-integration.js";
import type { ModerationExecutor } from "../../discord/moderation-executor.js";
import { resolvePlaceType, extractUrls } from "../../discord/message-utils.js";
import type {
  ActorRole,
  MessageEnvelope,
  WatchLocationConfig
} from "../../domain/types.js";
import type { HarnessRunner } from "../../harness/harness-runner.js";
import { ReplyDispatchService } from "../message/reply-dispatch-service.js";

export class AdminOverrideBootstrapService {
  constructor(
    private readonly harnessRunner: HarnessRunner,
    private readonly replyDispatchService: ReplyDispatchService,
    private readonly failureClassifier: FailureClassifier,
    private readonly moderationIntegration: BotModerationIntegration,
    private readonly moderationExecutor: ModerationExecutor,
    private readonly logger: Pick<Logger, "warn">
  ) {}

  async bootstrapPrompt(input: {
    thread: AnyThreadChannel;
    watchLocation: WatchLocationConfig;
    actorId: string;
    actorRole: Extract<ActorRole, "owner" | "admin">;
    prompt: string;
    requestId: string;
  }): Promise<void> {
    const envelope = {
      guildId: input.watchLocation.guildId,
      channelId: input.thread.id,
      messageId: input.requestId,
      authorId: input.actorId,
      placeType: resolvePlaceType(input.thread, input.watchLocation.mode),
      rawPlaceType: ChannelType[input.thread.type] ?? String(input.thread.type),
      content: input.prompt.trim(),
      urls: extractUrls(input.prompt),
      receivedAt: new Date().toISOString()
    } as const;
    const messageContext = {
      envelope,
      watchLocation: input.watchLocation,
      actorRole: input.actorRole,
      scope: "conversation_only" as const
    };

    let routed: Awaited<ReturnType<HarnessRunner["routeMessage"]>>;
    try {
      routed = await this.harnessRunner.routeMessage(messageContext);
    } catch (error) {
      await this.handleFailure(input, envelope.messageId, error, "fetch_or_resolve");
      return;
    }

    try {
      await this.replyDispatchService.dispatchHarnessResponseToChannel({
        channel: input.thread,
        messageContext,
        response: routed.response,
        session: routed.session,
        knowledgePersistenceScope: routed.knowledgePersistenceScope
      });
    } catch (error) {
      await this.handleFailure(input, envelope.messageId, error, "dispatch");
      return;
    }

    try {
      await this.runPostResponseModeration(messageContext, routed);
    } catch (error) {
      await this.handleFailure(input, envelope.messageId, error, "post_response");
    }
  }

  private async runPostResponseModeration(
    messageContext: {
      envelope: MessageEnvelope;
      watchLocation: WatchLocationConfig;
      actorRole: Extract<ActorRole, "owner" | "admin">;
      scope: "conversation_only";
    },
    routed: Awaited<ReturnType<HarnessRunner["routeMessage"]>>
  ): Promise<void> {
    if (!this.moderationIntegration.afterResponse) {
      return;
    }

    const callbackInput: PostResponseModerationInput = {
      envelope: messageContext.envelope,
      watchLocation: messageContext.watchLocation,
      actorRole: messageContext.actorRole,
      scope: messageContext.scope,
      response: routed.response,
      session: routed.session,
      moderation_signal: routed.moderationSignal,
      violation_counter_suspended: routed.violationCounterSuspended,
      executeModeration: this.moderationExecutor,
      notifySanctionStateChange: async (payload) =>
        this.replyDispatchService.notifySanctionStateChange(
          messageContext.watchLocation.guildId,
          payload
        )
    };
    await this.moderationIntegration.afterResponse(callbackInput);
  }

  private async handleFailure(
    input: {
      thread: AnyThreadChannel;
      watchLocation: WatchLocationConfig;
    },
    messageId: string,
    error: unknown,
    stage: FailureStage
  ): Promise<void> {
    const decision = this.failureClassifier.classify(error, {
      stage,
      attemptCount: 0,
      watchMode: input.watchLocation.mode
    });
    const notice = buildNonRetryingFailureNotice(decision.publicCategory);

    try {
      await this.replyDispatchService.sendChunksToChannel(input.thread, notice);
    } catch (notifyError) {
      this.logger.warn(
        {
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
          threadId: input.thread.id,
          stage
        },
        "failed to notify override bootstrap failure in thread"
      );
    }

    await this.replyDispatchService.notifyPermanentFailure({
      guildId: input.watchLocation.guildId,
      messageId,
      placeMode: input.watchLocation.mode,
      channelId: input.thread.id,
      error,
      stage,
      category: decision.publicCategory
    });
  }
}

function buildNonRetryingFailureNotice(
  category: ReturnType<FailureClassifier["classify"]>["publicCategory"]
): string {
  switch (category) {
    case "fetch_timeout":
      return "取得がタイムアウトしたため処理できませんでした。必要ならもう一度実行してください。";
    case "ai_processing_failed":
      return "AI処理に失敗したため処理できませんでした。必要ならもう一度実行してください。";
    default:
      return buildFailureNotice({ category });
  }
}
