import type { Message } from "discord.js";
import type { Logger } from "pino";
import { z } from "zod";

import type { CodexAppServerClient } from "../../codex/app-server-client.js";
import { CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE } from "../../codex/session-policy.js";
import { isQuestionGatewayPlace } from "../../domain/place-features.js";
import type { MessageEnvelope, WatchLocationConfig } from "../../domain/types.js";
import type { SqliteStore } from "../../storage/database.js";
import {
  THREAD_WORKFLOW_VALUES,
  type ThreadWorkflow
} from "../../storage/types.js";

const threadWorkflowGatewaySchema = z.object({
  workflow: z.enum(THREAD_WORKFLOW_VALUES),
  reason: z.string().nullable()
});

export type ThreadWorkflowGatewayDecision = z.infer<
  typeof threadWorkflowGatewaySchema
>;

export const threadWorkflowGatewayJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["workflow", "reason"],
  properties: {
    workflow: {
      type: "string",
      enum: [...THREAD_WORKFLOW_VALUES]
    },
    reason: {
      type: ["string", "null"]
    }
  }
} as const;

export type ThreadWorkflowGatewayResolution =
  | {
      decision: "pass";
    }
  | {
      decision: "route";
      workflow: ThreadWorkflow;
    }
  | {
      decision: "fail";
      notice: string;
    };

const GATEWAY_FAILURE_NOTICE =
  "このスレッドで使う処理フローを決められませんでした。自動で別フローには切り替えないため、必要なら内容を少し具体化して新しいスレッドで投稿してください。";
const MISSING_ROUTE_NOTICE =
  "このスレッドの処理フローが保存されていないため、続きとして処理できません。必要なら新しいスレッドで投稿してください。";

export class ThreadWorkflowGateway {
  constructor(
    private readonly store: SqliteStore,
    private readonly codexClient: CodexAppServerClient,
    private readonly logger: Pick<Logger, "warn">
  ) {}

  async resolve(input: {
    message: Message<true>;
    envelope: MessageEnvelope;
    watchLocation: WatchLocationConfig;
  }): Promise<ThreadWorkflowGatewayResolution> {
    if (!isQuestionGatewayPlace(input.watchLocation)) {
      return {
        decision: "pass"
      };
    }

    if (!input.message.channel.isThread()) {
      return {
        decision: "fail",
        notice: MISSING_ROUTE_NOTICE
      };
    }

    const threadId = input.envelope.channelId;
    const existingRoute = this.store.threadWorkflowRoutes.get(threadId);
    if (existingRoute) {
      return {
        decision: "route",
        workflow: existingRoute.workflow
      };
    }

    const starterMessageId = await this.resolveStarterMessageId(input.message);
    if (starterMessageId !== input.envelope.messageId) {
      return {
        decision: "fail",
        notice: MISSING_ROUTE_NOTICE
      };
    }

    const selected = await this.selectStarterWorkflow(input);
    if (!selected) {
      return {
        decision: "fail",
        notice: GATEWAY_FAILURE_NOTICE
      };
    }

    this.store.threadWorkflowRoutes.mark({
      threadId,
      rootChannelId: input.watchLocation.channelId,
      firstMessageId: input.envelope.messageId,
      workflow: selected.workflow,
      selectedBy: "starter_gateway",
      selectedByActorId: null,
      reason: selected.reason
    });
    return {
      decision: "route",
      workflow: selected.workflow
    };
  }

  switchWorkflow(input: {
    threadId: string;
    rootChannelId: string;
    firstMessageId: string;
    workflow: string;
    actorId: string;
    reason: string | null;
  }):
    | {
        ok: true;
        workflow: ThreadWorkflow;
      }
    | {
        ok: false;
        reason: "forbidden_workflow";
      } {
    const parsedWorkflow = z.enum(THREAD_WORKFLOW_VALUES).safeParse(input.workflow);
    if (!parsedWorkflow.success) {
      return {
        ok: false,
        reason: "forbidden_workflow"
      };
    }

    this.store.threadWorkflowRoutes.mark({
      threadId: input.threadId,
      rootChannelId: input.rootChannelId,
      firstMessageId: input.firstMessageId,
      workflow: parsedWorkflow.data,
      selectedBy: "command",
      selectedByActorId: input.actorId,
      reason: input.reason
    });
    return {
      ok: true,
      workflow: parsedWorkflow.data
    };
  }

  private async selectStarterWorkflow(input: {
    envelope: MessageEnvelope;
    watchLocation: WatchLocationConfig;
  }): Promise<ThreadWorkflowGatewayDecision | null> {
    let ephemeralThreadId: string | null = null;
    try {
      ephemeralThreadId = await this.codexClient.startEphemeralThread(
        "read-only",
        CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE
      );
      const result = await this.codexClient.runJsonTurn({
        threadId: ephemeralThreadId,
        inputPayload: {
          kind: "thread_workflow_gateway",
          contract:
            "Select exactly one allowed internal workflow for this question-gateway starter thread. Do not return redirect outcomes, normal chat, unsupported, or any workflow outside the allowlist.",
          allowed_workflows: {
            clear_explanation:
              "Use for bounded educational explanation: concepts, mechanisms, terminology, background, step-by-step understanding, or direct teaching in the current thread.",
            forum_research:
              "Use for broad analysis, open-ended consideration, strategy, design consultation, research, evaluation, synthesis across viewpoints, or work that should use the forum_research workflow."
          },
          place: {
            root_channel_id: input.watchLocation.channelId,
            thread_id: input.envelope.channelId,
            features: input.watchLocation.features ?? []
          },
          message: {
            message_id: input.envelope.messageId,
            content: input.envelope.content,
            urls: input.envelope.urls
          }
        },
        allowExternalFetch: false,
        outputSchema: threadWorkflowGatewayJsonSchema,
        parser: (value) => threadWorkflowGatewaySchema.parse(value),
        modelProfile: CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE
      });
      return result.response;
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: input.envelope.messageId,
          threadId: input.envelope.channelId
        },
        "thread workflow gateway failed without fallback"
      );
      return null;
    } finally {
      if (ephemeralThreadId) {
        await this.codexClient.closeEphemeralThread(ephemeralThreadId).catch(
          () => undefined
        );
      }
    }
  }

  private async resolveStarterMessageId(
    message: Message<true>
  ): Promise<string | null> {
    if (!message.channel.isThread()) {
      return null;
    }

    if (message.id === message.channel.id) {
      return message.id;
    }

    const starter = await message.channel.fetchStarterMessage().catch(() => null);
    return starter?.id ?? null;
  }
}
