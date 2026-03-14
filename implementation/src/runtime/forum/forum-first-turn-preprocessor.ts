import type { Message } from "discord.js";
import type { Logger } from "pino";

import { SessionPolicyResolver } from "../../codex/session-policy.js";
import type { ActorRole, MessageEnvelope, Scope, WatchLocationConfig } from "../../domain/types.js";
import type { SqliteStore } from "../../storage/database.js";

export type ForumFirstTurnPreparation = {
  preparedPrompt: string | null;
  progressNotice: string | null;
  wasPreprocessed: boolean;
  starterMessage: string | null;
};

export class ForumFirstTurnPreprocessor {
  constructor(
    private readonly store: SqliteStore,
    private readonly sessionPolicyResolver: SessionPolicyResolver,
    private readonly logger: Pick<Logger, "warn">
  ) {
    void this.store;
    void this.sessionPolicyResolver;
    void this.logger;
  }

  async resolveEffectiveContentOverride(input: {
    message: Message<true>;
    envelope: MessageEnvelope;
    watchLocation: WatchLocationConfig;
    actorRole: ActorRole;
    scope: Scope;
  }): Promise<ForumFirstTurnPreparation> {
    const starterMessage =
      input.watchLocation.mode === "forum_longform" &&
      input.message.channel.isThread()
        ? await this.fetchStarterMessage(input.message)
        : null;
    return {
      ...emptyPreparation(),
      starterMessage
    };
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
    starterMessage: null
  };
}
