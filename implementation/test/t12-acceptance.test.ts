import assert from "node:assert/strict";
import test from "node:test";

import type { ActorRole } from "../src/domain/types.js";

type ViolationCategory = "none" | "dangerous" | "prohibited";
type SanctionAction = "timeout" | "soft_block" | "kick";
type DeliveryStatus = "applied" | "fallback" | "failed";
type HandledAs = "countable" | "admin_exempt" | "suspended_override";

type ModerationSignalExpectation = {
  violation_category: ViolationCategory;
  control_request_class: string | null;
  notes: string | null;
};

type ViolationEventExpectation = {
  guildId: string;
  userId: string;
  messageId: string;
  actorRole: ActorRole;
  violationCategory: Exclude<ViolationCategory, "none">;
  controlRequestClass: string | null;
  countsTowardThreshold: boolean;
  handledAs: HandledAs;
};

type SanctionExpectation = {
  action: SanctionAction;
  deliveryStatus: DeliveryStatus;
  durationMs: number | null;
  reason: string;
};

type AdminControlNotificationExpectation = {
  guild_id: string;
  user_id: string;
  message_id: string;
  violation_category: Exclude<ViolationCategory, "none">;
  control_request_class: string | null;
  action: SanctionAction;
  delivery_status: DeliveryStatus;
  duration: string | null;
  reason: string;
};

function createModerationSignalExpectation(
  overrides: Partial<ModerationSignalExpectation> = {}
): ModerationSignalExpectation {
  return {
    violation_category: "dangerous",
    control_request_class: "dangerous-advice",
    notes: null,
    ...overrides
  };
}

function createViolationEventExpectation(
  overrides: Partial<ViolationEventExpectation> = {}
): ViolationEventExpectation {
  return {
    guildId: "guild-1",
    userId: "user-1",
    messageId: "message-1",
    actorRole: "user",
    violationCategory: "dangerous",
    controlRequestClass: "dangerous-advice",
    countsTowardThreshold: true,
    handledAs: "countable",
    ...overrides
  };
}

function createSanctionExpectation(
  overrides: Partial<SanctionExpectation> = {}
): SanctionExpectation {
  return {
    action: "timeout",
    deliveryStatus: "applied",
    durationMs: 24 * 60 * 60 * 1000,
    reason: "t12-threshold-reached",
    ...overrides
  };
}

function createAdminControlNotificationExpectation(
  overrides: Partial<AdminControlNotificationExpectation> = {}
): AdminControlNotificationExpectation {
  return {
    guild_id: "guild-1",
    user_id: "user-1",
    message_id: "message-1",
    violation_category: "dangerous",
    control_request_class: "dangerous-advice",
    action: "timeout",
    delivery_status: "applied",
    duration: "24h",
    reason: "t12-threshold-reached",
    ...overrides
  };
}

test("T12 helper expectations encode countable, exempt, and fallback states", () => {
  assert.deepEqual(createModerationSignalExpectation(), {
    violation_category: "dangerous",
    control_request_class: "dangerous-advice",
    notes: null
  });

  assert.deepEqual(
    createViolationEventExpectation({
      actorRole: "admin",
      countsTowardThreshold: false,
      handledAs: "admin_exempt"
    }),
    {
      guildId: "guild-1",
      userId: "user-1",
      messageId: "message-1",
      actorRole: "admin",
      violationCategory: "dangerous",
      controlRequestClass: "dangerous-advice",
      countsTowardThreshold: false,
      handledAs: "admin_exempt"
    }
  );

  assert.deepEqual(
    createSanctionExpectation({
      action: "soft_block",
      deliveryStatus: "fallback",
      durationMs: 30 * 24 * 60 * 60 * 1000,
      reason: "kick-failed"
    }),
    {
      action: "soft_block",
      deliveryStatus: "fallback",
      durationMs: 30 * 24 * 60 * 60 * 1000,
      reason: "kick-failed"
    }
  );

  assert.deepEqual(
    createAdminControlNotificationExpectation({
      action: "kick",
      duration: null,
      reason: "repeat-after-timeout"
    }),
    {
      guild_id: "guild-1",
      user_id: "user-1",
      message_id: "message-1",
      violation_category: "dangerous",
      control_request_class: "dangerous-advice",
      action: "kick",
      delivery_status: "applied",
      duration: null,
      reason: "repeat-after-timeout"
    }
  );
});

test(
  "T12 acceptance: moderation_signal=none records nothing and triggers no sanction evaluation",
  { skip: "pending T12 storage and bot-app implementation" },
  () => {
    const expectedSignal = createModerationSignalExpectation({
      violation_category: "none",
      control_request_class: null
    });
    const expectedOutcome = {
      violationEvent: null,
      sanction: null,
      adminControlNotification: null
    };

    void expectedSignal;
    void expectedOutcome;
  }
);

test(
  "T12 acceptance: the fifth countable violation in a 30-day rolling window applies a 24h timeout after normal reply",
  { skip: "pending T12 storage and bot-app implementation" },
  () => {
    const expectedEvent = createViolationEventExpectation();
    const expectedSanction = createSanctionExpectation({
      action: "timeout",
      deliveryStatus: "applied",
      durationMs: 24 * 60 * 60 * 1000,
      reason: "t12-threshold-reached"
    });
    const expectedNotification = createAdminControlNotificationExpectation({
      action: "timeout",
      delivery_status: "applied",
      duration: "24h",
      reason: "t12-threshold-reached"
    });

    void expectedEvent;
    void expectedSanction;
    void expectedNotification;
  }
);

test(
  "T12 acceptance: timeout failure falls back to a 24h soft-block with state-change notification",
  { skip: "pending T12 storage and bot-app implementation" },
  () => {
    const expectedEvent = createViolationEventExpectation();
    const expectedSanction = createSanctionExpectation({
      action: "soft_block",
      deliveryStatus: "fallback",
      durationMs: 24 * 60 * 60 * 1000,
      reason: "timeout-failed"
    });
    const expectedNotification = createAdminControlNotificationExpectation({
      action: "soft_block",
      delivery_status: "fallback",
      duration: "24h",
      reason: "timeout-failed"
    });

    void expectedEvent;
    void expectedSanction;
    void expectedNotification;
  }
);

test(
  "T12 acceptance: any countable violation within 90 days of timeout or soft-block escalates to kick, with 30d soft-block fallback on failure",
  { skip: "pending T12 storage and bot-app implementation" },
  () => {
    const expectedKick = createSanctionExpectation({
      action: "kick",
      deliveryStatus: "applied",
      durationMs: null,
      reason: "repeat-after-timeout"
    });
    const expectedKickFallback = createSanctionExpectation({
      action: "soft_block",
      deliveryStatus: "fallback",
      durationMs: 30 * 24 * 60 * 60 * 1000,
      reason: "kick-failed"
    });

    void expectedKick;
    void expectedKickFallback;
  }
);

test(
  "T12 acceptance: owner and admin actors create audit-only violation rows and never trigger sanctions",
  { skip: "pending T12 storage and bot-app implementation" },
  () => {
    const expectedOwnerAudit = createViolationEventExpectation({
      actorRole: "owner",
      countsTowardThreshold: false,
      handledAs: "admin_exempt"
    });
    const expectedAdminAudit = createViolationEventExpectation({
      actorRole: "admin",
      countsTowardThreshold: false,
      handledAs: "admin_exempt"
    });

    void expectedOwnerAudit;
    void expectedAdminAudit;
  }
);

test(
  "T12 acceptance: override thread suspension creates an audit-only row and suppresses both counting and sanction execution",
  { skip: "pending T12 storage and bot-app implementation" },
  () => {
    const expectedEvent = createViolationEventExpectation({
      countsTowardThreshold: false,
      handledAs: "suspended_override"
    });
    const expectedSanction = null;

    void expectedEvent;
    void expectedSanction;
  }
);

test(
  "T12 acceptance: active soft-block prevents Harness execution and throttles same-channel notices for 12 hours",
  { skip: "pending T12 storage and bot-app implementation" },
  () => {
    const expectedFirstChannelNotice = {
      blocked: true,
      notifySamePlace: true,
      notifyAgainAfterMs: 12 * 60 * 60 * 1000
    };
    const expectedSecondChannelNotice = {
      blocked: true,
      notifySamePlace: false
    };
    const expectedDifferentChannelNotice = {
      blocked: true,
      notifySamePlace: true
    };

    void expectedFirstChannelNotice;
    void expectedSecondChannelNotice;
    void expectedDifferentChannelNotice;
  }
);

test(
  "T12 acceptance: admin_control receives JSON notifications only for sanction state changes",
  { skip: "pending T12 storage and bot-app implementation" },
  () => {
    const expectedTimeoutNotification = createAdminControlNotificationExpectation({
      action: "timeout",
      delivery_status: "applied",
      duration: "24h"
    });
    const expectedSoftBlockNotification = createAdminControlNotificationExpectation({
      action: "soft_block",
      delivery_status: "fallback",
      duration: "24h"
    });
    const expectedKickNotification = createAdminControlNotificationExpectation({
      action: "kick",
      delivery_status: "applied",
      duration: null
    });

    void expectedTimeoutNotification;
    void expectedSoftBlockNotification;
    void expectedKickNotification;
  }
);
