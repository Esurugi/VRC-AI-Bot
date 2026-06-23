import type { Logger } from "pino";
import { z } from "zod";

import type { CodexAppServerClient } from "../../codex/app-server-client.js";
import { CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE } from "../../codex/session-policy.js";
import {
  isForumResearchPlace,
  isQuestionGatewayPlace
} from "../../domain/place-features.js";
import type { MessageEnvelope, WatchLocationConfig } from "../../domain/types.js";
import type { SqliteStore } from "../../storage/database.js";
import type { ClearExplanationGateDecision } from "../../storage/types.js";

export function buildClearExplanationQuestionGatewayRedirectNotice(
  watchLocations: WatchLocationConfig[],
  source: WatchLocationConfig
): string {
  const target =
    findConfiguredPlace(watchLocations, source, isQuestionGatewayPlace) ??
    findConfiguredPlace(watchLocations, source, isForumResearchPlace);
  const targetText = target ? `<#${target.channelId}>` : "質問受付";
  return `この内容は ${targetText} の「高度質問」の方が向いていそうです。広い検討・調査・比較・設計相談のように、じっくり考える必要がある質問はそちらに投稿してください。`;
}

export const CLEAR_EXPLANATION_FORUM_REDIRECT_NOTICE =
  buildClearExplanationQuestionGatewayRedirectNotice([], {
    guildId: "fallback",
    channelId: "fallback",
    mode: "chat",
    defaultScope: "server_public",
    features: ["clear_explanation", "conversation"],
    chatBehavior: null
  });

export const CLEAR_EXPLANATION_DECLINE_NOTICE =
  "ここは概念や仕組みをじっくり理解するための場所なので、この内容は教えてティラピコ向きではなさそうです。このスレッドでは処理しません。";

const gateDecisionSchema = z.object({
  decision: z.enum([
    "allow_clear_explanation",
    "redirect_to_forum_research",
    "decline_clear_explanation"
  ]),
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
      enum: [
        "allow_clear_explanation",
        "redirect_to_forum_research",
        "decline_clear_explanation"
      ]
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
  }): Promise<ClearExplanationGateDecision> {
    const threadId = input.envelope.channelId;
    const existingState = this.store.clearExplanationGateStates.get(threadId);
    if (existingState) {
      return existingState.decision;
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
            "Classify whether this first clear_explanation thread message should be handled by 教えてティラピコ, redirected to 高度質問, or declined without sending it to another fixed channel.",
          policy: {
            allow_clear_explanation:
              "Use only when the user is clearly asking for a bounded educational explanation: concepts, mechanisms, background, step-by-step understanding, terminology, or comparisons that can be taught directly in the current thread.",
            redirect_to_forum_research:
              "Use when the user asks for broad analysis, open-ended consideration, strategy, design consultation, research, evaluation, synthesis across viewpoints, or anything that should receive the 高度質問 / forum_research workflow rather than a direct teaching answer. If the message is ambiguous between 教えてティラピコ and 高度質問, choose redirect_to_forum_research.",
            decline_clear_explanation:
              "Use for casual chat, bot/meta questions, short factual questions, lookup/recommendation requests, troubleshooting, personal consultation, or anything not suitable for 教えてティラピコ or 高度質問. Do not route these to the雑談 channel."
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

function findConfiguredPlace(
  watchLocations: WatchLocationConfig[],
  source: WatchLocationConfig,
  predicate: (watchLocation: WatchLocationConfig) => boolean
): WatchLocationConfig | null {
  return (
    watchLocations.find(
      (watchLocation) =>
        watchLocation.guildId === source.guildId && predicate(watchLocation)
    ) ?? null
  );
}
