import type {
  CodexAppServerClient,
  HarnessTurnSessionMetadata,
  StreamingTextTurnCallbacks,
  TurnObservations
} from "../../src/codex/app-server-client.js";
import type {
  HarnessIntentResponse,
  HarnessRequest,
  HarnessResponse
} from "../../src/harness/contracts.js";
import type { CodexSandboxMode } from "../../src/domain/types.js";

export type ScriptedCodexEvent =
  | {
      type: "startThread";
      threadId: string;
      sandbox: CodexSandboxMode;
      modelProfile: string;
    }
  | {
      type: "intent";
      phase: HarnessRequest["task"]["phase"];
      mode: HarnessRequest["place"]["mode"];
      sessionIdentity: string | null;
      workloadKind: string | null;
      modelProfile: string | null;
    }
  | {
      type: "answer";
      phase: HarnessRequest["task"]["phase"];
      mode: HarnessRequest["place"]["mode"];
      retryKind: string | null;
      sessionIdentity: string | null;
      workloadKind: string | null;
      modelProfile: string | null;
    }
  | {
      type: "streamingFinal";
      text: string;
    }
  | {
      type: "json";
      kind: string | null;
      modelProfile: string | null;
    };

type AnswerTurn = {
  response: HarnessResponse;
  observations?: TurnObservations;
};

export class ScriptedCodexClient {
  readonly events: ScriptedCodexEvent[] = [];
  readonly requests: HarnessRequest[] = [];
  private threadOrdinal = 0;
  private readonly intentQueue: HarnessIntentResponse[] = [];
  private readonly answerQueue: AnswerTurn[] = [];
  private readonly clearExplanationGateQueue: Array<
    | {
        decision: "allow_clear_explanation" | "redirect_to_general_question";
        reason: string | null;
      }
    | Error
  > = [];
  private streamingText = "forum final";
  private streamingObservations: TurnObservations = {
    observed_public_urls: [],
    generated_images: []
  };

  enqueueIntent(response: HarnessIntentResponse): void {
    this.intentQueue.push(response);
  }

  enqueueAnswer(turn: AnswerTurn): void {
    this.answerQueue.push(turn);
  }

  enqueueClearExplanationGateDecision(input: {
    decision: "allow_clear_explanation" | "redirect_to_general_question";
    reason?: string | null;
  }): void {
    this.clearExplanationGateQueue.push({
      decision: input.decision,
      reason: input.reason ?? null
    });
  }

  enqueueClearExplanationGateError(error = new Error("scripted gate failure")): void {
    this.clearExplanationGateQueue.push(error);
  }

  setForumStreamingTurn(input: {
    text: string;
    observations?: TurnObservations;
  }): void {
    this.streamingText = input.text;
    this.streamingObservations = input.observations ?? {
      observed_public_urls: [],
      generated_images: []
    };
  }

  getSessionInvalidationGeneration(): number {
    return 0;
  }

  async startThread(
    sandbox: CodexSandboxMode,
    executionProfile: { modelProfile?: string; model?: string }
  ): Promise<string> {
    this.threadOrdinal += 1;
    const threadId = `codex-thread-${this.threadOrdinal}`;
    this.events.push({
      type: "startThread",
      threadId,
      sandbox,
      modelProfile: executionProfile.modelProfile ?? executionProfile.model ?? "unknown"
    });
    return threadId;
  }

  async resumeThread(): Promise<void> {
    return;
  }

  async archiveThread(): Promise<void> {
    return;
  }

  async unsubscribeThread(): Promise<void> {
    return;
  }

  async startEphemeralThread(
    _sandbox?: CodexSandboxMode,
    modelProfile?: string
  ): Promise<string> {
    this.threadOrdinal += 1;
    this.events.push({
      type: "startThread",
      threadId: `codex-ephemeral-${this.threadOrdinal}`,
      sandbox: _sandbox ?? "read-only",
      modelProfile: modelProfile ?? "unknown"
    });
    return `codex-ephemeral-${this.threadOrdinal}`;
  }

  async closeEphemeralThread(): Promise<void> {
    return;
  }

  async runHarnessIntentRequest(
    _threadId: string,
    request: HarnessRequest,
    sessionMetadata?: HarnessTurnSessionMetadata
  ): Promise<HarnessIntentResponse> {
    this.requests.push(request);
    this.events.push({
      type: "intent",
      phase: request.task.phase,
      mode: request.place.mode,
      sessionIdentity: sessionMetadata?.sessionIdentity ?? null,
      workloadKind: sessionMetadata?.workloadKind ?? null,
      modelProfile: sessionMetadata?.modelProfile ?? null
    });
    const response = this.intentQueue.shift();
    if (!response) {
      throw new Error("missing scripted intent response");
    }
    return response;
  }

  async runHarnessRequest(
    _threadId: string,
    request: HarnessRequest,
    sessionMetadata?: HarnessTurnSessionMetadata
  ): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
  }> {
    this.requests.push(request);
    this.events.push({
      type: "answer",
      phase: request.task.phase,
      mode: request.place.mode,
      retryKind: request.task.retry_context?.kind ?? null,
      sessionIdentity: sessionMetadata?.sessionIdentity ?? null,
      workloadKind: sessionMetadata?.workloadKind ?? null,
      modelProfile: sessionMetadata?.modelProfile ?? null
    });
    const turn = this.answerQueue.shift();
    if (!turn) {
      throw new Error("missing scripted answer response");
    }
    return {
      response: turn.response,
      observations: turn.observations ?? {
        observed_public_urls: [],
        generated_images: []
      }
    };
  }

  async runJsonTurn(input: {
    inputPayload: { kind?: string };
    modelProfile?: string;
  }): Promise<{
    response: unknown;
    observations: TurnObservations;
    turnId: string | null;
  }> {
    this.events.push({
      type: "json",
      kind: input.inputPayload.kind ?? null,
      modelProfile: input.modelProfile ?? null
    });

    if (input.inputPayload.kind === "clear_explanation_route_gate") {
      const queued = this.clearExplanationGateQueue.shift();
      if (queued instanceof Error) {
        throw queued;
      }

      return {
        response: queued ?? {
          decision: "allow_clear_explanation",
          reason: "default scripted allow"
        },
        observations: {
          observed_public_urls: [],
          generated_images: []
        },
        turnId: null
      };
    }

    if (input.inputPayload.kind === "forum_research_prompt_refiner") {
      return {
        response: {
          refined_prompt: "refined forum prompt",
          progress_notice: "調査の観点を整理しています。",
          prompt_rationale_summary: "test prompt"
        },
        observations: {
          observed_public_urls: [],
          generated_images: []
        },
        turnId: null
      };
    }

    if (input.inputPayload.kind === "forum_research_supervisor") {
      return {
        response: {
          progress_notice: "調査計画を確認しています。",
          worker_tasks: [],
          interrupts: [],
          next_action: "finalize",
          final_brief: "finalize from current public context"
        },
        observations: {
          observed_public_urls: [],
          generated_images: []
        },
        turnId: null
      };
    }

    throw new Error(`unexpected json turn kind: ${String(input.inputPayload.kind)}`);
  }

  async startJsonTurn(): Promise<{
    turnId: string | null;
    completion: Promise<{
      response: unknown;
      observations: TurnObservations;
      turnId: string | null;
    }>;
    interrupt: () => Promise<void>;
  }> {
    return {
      turnId: null,
      completion: Promise.resolve({
        response: {
          worker_id: "worker-1",
          subquestion: "test",
          evidence_items: [],
          citations: []
        },
        observations: {
          observed_public_urls: [],
          generated_images: []
        },
        turnId: null
      }),
      interrupt: async () => {}
    };
  }

  async runStreamingTextTurn(input: {
    sessionMetadata?: HarnessTurnSessionMetadata;
    callbacks?: StreamingTextTurnCallbacks;
  }): Promise<{
    response: string;
    observations: TurnObservations;
    turnId: string | null;
  }> {
    void input.sessionMetadata;
    this.events.push({
      type: "streamingFinal",
      text: this.streamingText
    });
    await input.callbacks?.onAgentMessageDelta?.(this.streamingText);
    return {
      response: this.streamingText,
      observations: this.streamingObservations,
      turnId: null
    };
  }
}

export function asCodexClient(client: ScriptedCodexClient): CodexAppServerClient {
  return client as unknown as CodexAppServerClient;
}

export function intent(input: {
  outcome?: HarnessIntentResponse["outcome_candidate"];
  fetch?: HarnessIntentResponse["requested_external_fetch"];
  write?: boolean;
  repoWrite?: boolean;
} = {}): HarnessIntentResponse {
  return {
    outcome_candidate: input.outcome ?? "chat_reply",
    repo_write_intent: input.repoWrite ?? false,
    requested_external_fetch: input.fetch ?? "none",
    requested_knowledge_write: input.write ?? false,
    moderation_signal: {
      violation_category: "none",
      control_request_class: null,
      notes: null
    },
    diagnostics: {
      notes: null
    }
  };
}

export function response(input: Partial<HarnessResponse>): HarnessResponse {
  return {
    outcome: "chat_reply",
    repo_write_intent: false,
    public_text: "テスト応答です。",
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [],
    knowledge_writes: [],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none",
    ...input
  };
}
