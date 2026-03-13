import type {
  ActorRole,
  MessageEnvelope,
  Scope,
  WatchLocationConfig
} from "../domain/types.js";
import type { ModerationExecutor } from "../discord/moderation-executor.js";
import type {
  HarnessIntentResponse,
  HarnessResponse
} from "../harness/contracts.js";
import type { HarnessResolvedSession } from "../harness/harness-runner.js";

export type SoftBlockPreflightInput = {
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
  actorRole: ActorRole;
  scope: Scope;
};

export type SoftBlockPreflightDecision = {
  blocked: boolean;
  notice_text: string | null;
};

export type SanctionAction = "timeout" | "soft_block" | "kick";
export type SanctionDeliveryStatus = "applied" | "fallback" | "failed";
export type SanctionViolationCategory = "dangerous" | "prohibited";

export type SanctionNotificationPayload = {
  guild_id: string;
  user_id: string;
  message_id: string;
  violation_category: SanctionViolationCategory;
  control_request_class: string | null;
  action: SanctionAction;
  delivery_status: SanctionDeliveryStatus;
  duration: string | null;
  reason: string;
};

export type PostResponseModerationInput = SoftBlockPreflightInput & {
  response: HarnessResponse;
  session: HarnessResolvedSession;
  moderation_signal: HarnessIntentResponse["moderation_signal"];
  violation_counter_suspended: boolean;
  executeModeration: ModerationExecutor;
  notifySanctionStateChange: (payload: SanctionNotificationPayload) => Promise<void>;
};

export interface BotModerationIntegration {
  checkSoftBlock(input: SoftBlockPreflightInput): Promise<SoftBlockPreflightDecision>;
  afterResponse?(input: PostResponseModerationInput): Promise<void>;
}

export const NOOP_BOT_MODERATION_INTEGRATION: BotModerationIntegration = {
  async checkSoftBlock(): Promise<SoftBlockPreflightDecision> {
    return {
      blocked: false,
      notice_text: null
    };
  },
  async afterResponse(): Promise<void> {
    return;
  }
};
