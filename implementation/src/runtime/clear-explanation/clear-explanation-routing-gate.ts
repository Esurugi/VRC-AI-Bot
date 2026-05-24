import type { Logger } from "pino";
import { z } from "zod";

import type { CodexAppServerClient } from "../../codex/app-server-client.js";
import { CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE } from "../../codex/session-policy.js";
import type { MessageEnvelope, WatchLocationConfig } from "../../domain/types.js";
import type { SqliteStore } from "../../storage/database.js";

export const GENERAL_QUESTION_CHANNEL_ID = "1365210184657670207";
export const CLEAR_EXPLANATION_REDIRECT_NOTICE =
  `この内容は <#${GENERAL_QUESTION_CHANNEL_ID}> の「なんでも質問」の方が向いていそうです。ここは概念や仕組みをじっくり理解するための場所なので、短い質問・相談・調べもの・雑談はそちらに送ってください。`;

const gateDecisionSchema = z.object({
  decision: z.enum(["allow_clear_explanation", "redirect_to_general_question"]),
  reason: z.string().nullable()
});

export type ClearExplanationRoutingGateDecision = z.infer<
  typeof gateDecisionSchema
>;

export const clearExplanationRoutingGateJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "reason"],
  properties: {
    decision: {
      type: "string",
      enum: ["allow_clear_explanation", "redirect_to_general_question"]
    },
    reason: {
      type: ["string", "null"]
    }
  }
} as const;

export class ClearExplanationRoutingGate {
  constructor(
    private readonly store: SqliteStore,
    private readonly codexClient: CodexAppServerClient,
    private readonly logger: Pick<Logger, "warn">
  ) {}

  async decide(input: {
    envelope: MessageEnvelope;
    watchLocation: WatchLocationConfig;
  }): Promise<ClearExplanationRoutingGateDecision["decision"]> {
    const threadId = input.envelope.channelId;
    const existingState = this.store.clearExplanationGateStates.get(threadId);
    if (existingState) {
      return "allow_clear_explanation";
    }

    const existingClearSession = this.store.codexSessions.findThreadBinding({
      workloadKind: "clear_explanation",
      bindingId: threadId
    });
    if (existingClearSession) {
      this.store.clearExplanationGateStates.mark({
        threadId,
        rootChannelId: input.watchLocation.channelId,
        firstMessageId: input.envelope.messageId,
        decision: "allow_clear_explanation",
        reason: "existing_clear_explanation_session"
      });
      return "allow_clear_explanation";
    }

    let ephemeralThreadId: string | null = null;
    try {
      ephemeralThreadId = await this.codexClient.startEphemeralThread(
        "read-only",
        CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE
      );
      const result = await this.codexClient.runJsonTurn({
        threadId: ephemeralThreadId,
        inputPayload: {
          kind: "clear_explanation_route_gate",
          contract:
            "Classify whether this first clear_explanation thread message should be handled by 教えてティラピコ or redirected to なんでも質問.",
          policy: {
            allow_clear_explanation:
              "Use only when the user is clearly asking for conceptual understanding, mechanisms, background, step-by-step explanation, comparisons, or an educational explanation that benefits from 教えてティラピコ.",
            redirect_to_general_question:
              "Use for short factual questions, lookup/recommendation requests, troubleshooting or personal consultation not framed as conceptual understanding, casual chat, bot/meta questions, or any ambiguous message."
          },
          place: {
            root_channel_id: input.watchLocation.channelId,
            thread_id: threadId,
            features: input.watchLocation.features ?? []
          },
          message: {
            message_id: input.envelope.messageId,
            content: input.envelope.content,
            urls: input.envelope.urls
          }
        },
        allowExternalFetch: false,
        outputSchema: clearExplanationRoutingGateJsonSchema,
        parser: (value) => gateDecisionSchema.parse(value),
        modelProfile: CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE
      });

      this.store.clearExplanationGateStates.mark({
        threadId,
        rootChannelId: input.watchLocation.channelId,
        firstMessageId: input.envelope.messageId,
        decision: result.response.decision,
        reason: result.response.reason
      });
      return result.response.decision;
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: input.envelope.messageId,
          threadId
        },
        "clear explanation routing gate failed open"
      );
      this.store.clearExplanationGateStates.mark({
        threadId,
        rootChannelId: input.watchLocation.channelId,
        firstMessageId: input.envelope.messageId,
        decision: "allow_clear_explanation",
        reason: "gate_failed_open"
      });
      return "allow_clear_explanation";
    } finally {
      if (ephemeralThreadId) {
        await this.codexClient.closeEphemeralThread(ephemeralThreadId).catch(
          () => undefined
        );
      }
    }
  }
}
