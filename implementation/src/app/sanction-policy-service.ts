import { randomUUID } from "node:crypto";

import type { Logger } from "pino";

import type { ModerationExecutor } from "../discord/moderation-executor.js";
import type { ActorRole } from "../domain/types.js";
import type { SqliteStore } from "../storage/database.js";
import type {
  BotModerationIntegration,
  PostResponseModerationInput,
  SanctionAction,
  SanctionDeliveryStatus,
  SanctionNotificationPayload,
  SoftBlockPreflightDecision,
  SoftBlockPreflightInput
} from "./moderation-integration.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_24H_MS = 24 * 60 * 60 * 1000;
const SOFT_BLOCK_30D_MS = 30 * 24 * 60 * 60 * 1000;

type CountableHandling = "countable" | "admin_exempt" | "suspended_override";

export class SanctionPolicyService {
  constructor(
    private readonly store: SqliteStore,
    private readonly logger?: Pick<Logger, "warn" | "debug">
  ) {}

  async checkSoftBlock(
    input: SoftBlockPreflightInput,
    now = new Date()
  ): Promise<SoftBlockPreflightDecision> {
    if (input.actorRole !== "user") {
      return {
        blocked: false,
        notice_text: null
      };
    }

    const nowIso = now.toISOString();
    const active = this.store.sanctionStates.getActiveSoftBlock(
      input.envelope.guildId,
      input.envelope.authorId,
      nowIso
    );
    if (!active) {
      return {
        blocked: false,
        notice_text: null
      };
    }

    const lastNotice = this.store.softBlockNotices.get(
      input.envelope.guildId,
      input.envelope.authorId,
      input.envelope.channelId
    );
    const shouldNotify =
      !lastNotice ||
      now.getTime() - Date.parse(lastNotice.last_notified_at) >= TWELVE_HOURS_MS;

    if (shouldNotify) {
      this.store.softBlockNotices.upsert({
        guildId: input.envelope.guildId,
        userId: input.envelope.authorId,
        channelId: input.envelope.channelId,
        lastNotifiedAt: nowIso
      });
    }

    return {
      blocked: true,
      notice_text: shouldNotify
        ? "現在このサーバーでは一定期間 bot を利用できません。"
        : null
    };
  }

  async recordAndEvaluate(
    input: PostResponseModerationInput,
    now = new Date()
  ): Promise<void> {
    const signal = input.moderation_signal;
    if (signal.violation_category === "none") {
      return;
    }

    const nowIso = now.toISOString();
    const handling = resolveHandling(input.actorRole, input.violation_counter_suspended);
    const eventId = randomUUID();
    this.store.violationEvents.append({
      eventId,
      guildId: input.envelope.guildId,
      userId: input.envelope.authorId,
      messageId: input.envelope.messageId,
      placeId: input.envelope.channelId,
      violationCategory: signal.violation_category,
      controlRequestClass: signal.control_request_class,
      handledAs: handling,
      countsTowardThreshold: handling === "countable",
      actorRole: input.actorRole,
      occurredAt: nowIso
    });

    if (handling !== "countable") {
      return;
    }

    const recentSanctions = this.store.sanctionStates.listRecentForActor({
      guildId: input.envelope.guildId,
      userId: input.envelope.authorId,
      startedAtGte: new Date(now.getTime() - NINETY_DAYS_MS).toISOString(),
      actions: ["timeout", "soft_block"]
    });

    if (recentSanctions.length > 0) {
      await this.applyKickFlow({
        input,
        triggerEventId: eventId,
        violationCategory: signal.violation_category,
        controlRequestClass: signal.control_request_class,
        now
      });
      return;
    }

    const rollingCount = this.store.violationEvents.countForActorSince({
      guildId: input.envelope.guildId,
      userId: input.envelope.authorId,
      occurredAtGte: new Date(now.getTime() - THIRTY_DAYS_MS).toISOString(),
      countableOnly: true
    });
    if (rollingCount !== 5) {
      return;
    }

    await this.applyTimeoutFlow({
      input,
      triggerEventId: eventId,
      violationCategory: signal.violation_category,
      controlRequestClass: signal.control_request_class,
      now
    });
  }

  private async applyTimeoutFlow(input: {
    input: PostResponseModerationInput;
    triggerEventId: string;
    violationCategory: SanctionNotificationPayload["violation_category"];
    controlRequestClass: string | null;
    now: Date;
  }): Promise<void> {
    const result = await input.input.executeModeration.timeoutMember(
      input.input.envelope.guildId,
      input.input.envelope.authorId,
      TIMEOUT_24H_MS,
      "t12-threshold-reached"
    );
    const nowIso = input.now.toISOString();

    if (result.ok) {
      this.store.sanctionStates.insert({
        sanctionId: randomUUID(),
        guildId: input.input.envelope.guildId,
        userId: input.input.envelope.authorId,
        state: "active",
        action: "timeout",
        deliveryStatus: "applied",
        triggerEventId: input.triggerEventId,
        startedAt: nowIso,
        endsAt: new Date(input.now.getTime() + TIMEOUT_24H_MS).toISOString(),
        reason: "t12-threshold-reached"
      });
      await input.input.notifySanctionStateChange(
        buildNotificationPayload({
          guildId: input.input.envelope.guildId,
          userId: input.input.envelope.authorId,
          messageId: input.input.envelope.messageId,
          violationCategory: input.violationCategory,
          controlRequestClass: input.controlRequestClass,
          action: "timeout",
          deliveryStatus: "applied",
          duration: "24h",
          reason: "t12-threshold-reached"
        })
      );
      return;
    }

    this.store.sanctionStates.insert({
      sanctionId: randomUUID(),
      guildId: input.input.envelope.guildId,
      userId: input.input.envelope.authorId,
      state: "active",
      action: "soft_block",
      deliveryStatus: "fallback",
      triggerEventId: input.triggerEventId,
      startedAt: nowIso,
      endsAt: new Date(input.now.getTime() + TIMEOUT_24H_MS).toISOString(),
      reason: "timeout-failed"
    });
    await input.input.notifySanctionStateChange(
      buildNotificationPayload({
        guildId: input.input.envelope.guildId,
        userId: input.input.envelope.authorId,
        messageId: input.input.envelope.messageId,
        violationCategory: input.violationCategory,
        controlRequestClass: input.controlRequestClass,
        action: "soft_block",
        deliveryStatus: "fallback",
        duration: "24h",
        reason: "timeout-failed"
      })
    );
  }

  private async applyKickFlow(input: {
    input: PostResponseModerationInput;
    triggerEventId: string;
    violationCategory: SanctionNotificationPayload["violation_category"];
    controlRequestClass: string | null;
    now: Date;
  }): Promise<void> {
    const result = await input.input.executeModeration.kickMember(
      input.input.envelope.guildId,
      input.input.envelope.authorId,
      "repeat-after-timeout"
    );
    const nowIso = input.now.toISOString();

    if (result.ok) {
      this.store.sanctionStates.insert({
        sanctionId: randomUUID(),
        guildId: input.input.envelope.guildId,
        userId: input.input.envelope.authorId,
        state: "completed",
        action: "kick",
        deliveryStatus: "applied",
        triggerEventId: input.triggerEventId,
        startedAt: nowIso,
        endsAt: null,
        reason: "repeat-after-timeout"
      });
      await input.input.notifySanctionStateChange(
        buildNotificationPayload({
          guildId: input.input.envelope.guildId,
          userId: input.input.envelope.authorId,
          messageId: input.input.envelope.messageId,
          violationCategory: input.violationCategory,
          controlRequestClass: input.controlRequestClass,
          action: "kick",
          deliveryStatus: "applied",
          duration: null,
          reason: "repeat-after-timeout"
        })
      );
      return;
    }

    this.store.sanctionStates.insert({
      sanctionId: randomUUID(),
      guildId: input.input.envelope.guildId,
      userId: input.input.envelope.authorId,
      state: "active",
      action: "soft_block",
      deliveryStatus: "fallback",
      triggerEventId: input.triggerEventId,
      startedAt: nowIso,
      endsAt: new Date(input.now.getTime() + SOFT_BLOCK_30D_MS).toISOString(),
      reason: "kick-failed"
    });
    await input.input.notifySanctionStateChange(
      buildNotificationPayload({
        guildId: input.input.envelope.guildId,
        userId: input.input.envelope.authorId,
        messageId: input.input.envelope.messageId,
        violationCategory: input.violationCategory,
        controlRequestClass: input.controlRequestClass,
        action: "soft_block",
        deliveryStatus: "fallback",
        duration: "30d",
        reason: "kick-failed"
      })
    );
  }
}

export function createBotModerationIntegration(
  store: SqliteStore,
  logger?: Pick<Logger, "warn" | "debug">
): BotModerationIntegration {
  const service = new SanctionPolicyService(store, logger);

  return {
    async checkSoftBlock(input): Promise<SoftBlockPreflightDecision> {
      return service.checkSoftBlock(input);
    },
    async afterResponse(input): Promise<void> {
      await service.recordAndEvaluate(input);
    }
  };
}

function resolveHandling(
  actorRole: ActorRole,
  violationCounterSuspended: boolean
): CountableHandling {
  if (actorRole === "owner" || actorRole === "admin") {
    return "admin_exempt";
  }
  if (violationCounterSuspended) {
    return "suspended_override";
  }
  return "countable";
}

function buildNotificationPayload(input: {
  guildId: string;
  userId: string;
  messageId: string;
  violationCategory: SanctionNotificationPayload["violation_category"];
  controlRequestClass: string | null;
  action: SanctionAction;
  deliveryStatus: SanctionDeliveryStatus;
  duration: string | null;
  reason: string;
}): SanctionNotificationPayload {
  return {
    guild_id: input.guildId,
    user_id: input.userId,
    message_id: input.messageId,
    violation_category: input.violationCategory,
    control_request_class: input.controlRequestClass,
    action: input.action,
    delivery_status: input.deliveryStatus,
    duration: input.duration,
    reason: input.reason
  };
}
