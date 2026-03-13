import type { Message, ThreadChannel } from "discord.js";
import type { Logger } from "pino";

import type { ForumPromptPreparationExecutor } from "../../codex/codex-exec-prompt-preprocessor-adapter.js";
import { SessionPolicyResolver } from "../../codex/session-policy.js";
import type { ActorRole, MessageEnvelope, Scope, WatchLocationConfig } from "../../domain/types.js";
import type { SqliteStore } from "../../storage/database.js";

export type ForumFirstTurnPreparation = {
  preparedPrompt: string | null;
  progressNotice: string | null;
  wasPreprocessed: boolean;
};

export class ForumFirstTurnPreprocessor {
  constructor(
    private readonly store: SqliteStore,
    private readonly sessionPolicyResolver: SessionPolicyResolver,
    private readonly executor: ForumPromptPreparationExecutor,
    private readonly logger: Pick<Logger, "warn">
  ) {}

  async prepare(
    thread: Pick<ThreadChannel, "id">,
    starterMessage: string
  ): Promise<ForumFirstTurnPreparation> {
    const result = await this.executor.prepareForumFirstTurnPrompt({
      threadId: thread.id,
      starterMessage
    });
    const preparedPrompt = result.preparedPrompt.trim();

    if (!preparedPrompt) {
      return {
        preparedPrompt: null,
        progressNotice: null,
        wasPreprocessed: false
      };
    }

    return {
      preparedPrompt,
      progressNotice: result.progressNotice?.trim() ? result.progressNotice.trim() : null,
      wasPreprocessed: true
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
      return {
        preparedPrompt: null,
        progressNotice: null,
        wasPreprocessed: false
      };
    }

    const starterMessage = await this.fetchStarterMessage(input.message);
    if (!starterMessage?.trim()) {
      return {
        preparedPrompt: null,
        progressNotice: null,
        wasPreprocessed: false
      };
    }

    try {
      return await this.prepare(input.message.channel, starterMessage);
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          threadId: input.message.channel.id,
          messageId: input.message.id
        },
        "forum first-turn preprocessing failed; falling back to raw message content"
      );
      return {
        preparedPrompt: null,
        progressNotice: null,
        wasPreprocessed: false
      };
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
