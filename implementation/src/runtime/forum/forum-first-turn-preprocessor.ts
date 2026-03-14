import type { Message, ThreadChannel } from "discord.js";
import type { Logger } from "pino";

import { SessionPolicyResolver } from "../../codex/session-policy.js";
import type { ActorRole, MessageEnvelope, Scope, WatchLocationConfig } from "../../domain/types.js";
import type { ForumResearchPlan } from "../../forum-research/types.js";
import type { SqliteStore } from "../../storage/database.js";
import type { ForumResearchPlanner } from "./forum-research-planner.js";

export type ForumFirstTurnPreparation = {
  preparedPrompt: string | null;
  progressNotice: string | null;
  wasPreprocessed: boolean;
  researchPlan: ForumResearchPlan | null;
};

export class ForumFirstTurnPreprocessor {
  constructor(
    private readonly store: SqliteStore,
    private readonly sessionPolicyResolver: SessionPolicyResolver,
    private readonly planner: ForumResearchPlanner,
    private readonly logger: Pick<Logger, "warn">
  ) {}

  async prepare(
    thread: Pick<ThreadChannel, "id">,
    currentMessage: string,
    starterMessage: string
  ): Promise<ForumFirstTurnPreparation> {
    const result = await this.planner.plan({
      messageId: thread.id,
      currentMessage,
      starterMessage,
      isInitialTurn: true,
      threadId: thread.id
    });
    const preparedPrompt = result.effective_user_text?.trim() || null;

    return {
      preparedPrompt,
      progressNotice: result.progress_notice?.trim()
        ? result.progress_notice.trim()
        : null,
      wasPreprocessed: Boolean(preparedPrompt),
      researchPlan: result
    };
  }

  async resolveEffectiveContentOverride(input: {
    message: Message<true>;
    envelope: MessageEnvelope;
    watchLocation: WatchLocationConfig;
    actorRole: ActorRole;
    scope: Scope;
  }): Promise<ForumFirstTurnPreparation> {
    if (!(await this.needsPreparation(input))) {
      return emptyPreparation();
    }

    const starterMessage = await this.fetchStarterMessage(input.message);
    if (!starterMessage?.trim()) {
      return emptyPreparation();
    }

    try {
      return await this.prepare(
        input.message.channel,
        input.message.content.trim(),
        starterMessage
      );
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          threadId: input.message.channel.id,
          messageId: input.message.id
        },
        "forum first-turn planner failed"
      );
      return emptyPreparation();
    }
  }

  async needsPreparation(input: {
    message: Message<true>;
    envelope: MessageEnvelope;
    watchLocation: WatchLocationConfig;
    actorRole: ActorRole;
    scope: Scope;
  }): Promise<boolean> {
    if (
      input.watchLocation.mode !== "forum_longform" ||
      input.envelope.placeType !== "forum_post_thread" ||
      !input.message.channel.isThread()
    ) {
      return false;
    }

    const sessionIdentity = this.sessionPolicyResolver.resolveForMessage({
      envelope: input.envelope,
      watchLocation: input.watchLocation,
      actorRole: input.actorRole,
      scope: input.scope,
      workspaceWriteActive: false
    });

    return !this.store.codexSessions.get(sessionIdentity.sessionIdentity);
  }

  private async fetchStarterMessage(message: Message<true>): Promise<string | null> {
    if (!message.channel.isThread()) {
      return null;
    }

    const starter = await message.channel.fetchStarterMessage().catch(() => null);
    return starter?.content?.trim() ? starter.content.trim() : null;
  }
}

function emptyPreparation(): ForumFirstTurnPreparation {
  return {
    preparedPrompt: null,
    progressNotice: null,
    wasPreprocessed: false,
    researchPlan: null
  };
}
