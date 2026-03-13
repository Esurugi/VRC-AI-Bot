import type { Logger } from "pino";
import { z } from "zod";

import type {
  CodexAppServerClient,
  HarnessTurnSessionMetadata,
  TurnControlPolicy,
  TurnObservations
} from "../codex/app-server-client.js";
import { appendRuntimeTrace } from "../observability/runtime-trace.js";
import {
  harnessResponseJsonSchema,
  harnessResponseSchema,
  type HarnessRequest,
  type HarnessResponse
} from "./contracts.js";

export type ForumExplorationPhase =
  | "acquire"
  | "integrate"
  | "verify"
  | "finalize";

export type ForumMaterialGap = {
  gap: string;
  needsObservation: boolean;
  suggestedOperator: "web_search" | "open_page" | "find_in_page" | "none";
};

export type ForumContradiction = {
  a: string;
  b: string;
  material: boolean;
};

export type ForumStopJudgement = {
  done: boolean;
  reason: string;
  marginalValue: "high" | "medium" | "low";
};

export type ForumTerminationReason =
  | "work_turn_failed"
  | "checkpoint_failed"
  | "iteration_budget_exhausted"
  | "time_budget_exhausted"
  | "interrupt_timeout";

export type ForumTermination = {
  reason: ForumTerminationReason;
  detail: string;
};

export type ForumLoopState = {
  phase: ForumExplorationPhase;
  iteration: number;
  resolvedItems: string[];
  openItems: string[];
  materialGaps: ForumMaterialGap[];
  contradictions: ForumContradiction[];
  evidenceDigest: string;
  provisionalOutline: string;
  stopJudgement: ForumStopJudgement;
  termination: ForumTermination | null;
};

const forumCheckpointSchema = z.object({
  phase_result: z.enum(["acquired", "integrated", "verified", "blocked"]),
  resolved_items: z.array(z.string()),
  open_items: z.array(z.string()),
  material_gaps: z.array(
    z.object({
      gap: z.string(),
      needs_observation: z.boolean(),
      suggested_operator: z.enum([
        "web_search",
        "open_page",
        "find_in_page",
        "none"
      ])
    })
  ),
  contradictions: z.array(
    z.object({
      a: z.string(),
      b: z.string(),
      material: z.boolean()
    })
  ),
  evidence_digest: z.string(),
  provisional_outline: z.string(),
  next_phase: z.enum(["acquire", "integrate", "verify", "finalize"]),
  stop_judgement: z.object({
    done: z.boolean(),
    reason: z.string(),
    marginal_value: z.enum(["high", "medium", "low"])
  })
});

export type ForumCheckpoint = z.infer<typeof forumCheckpointSchema>;

export const forumCheckpointJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "phase_result",
    "resolved_items",
    "open_items",
    "material_gaps",
    "contradictions",
    "evidence_digest",
    "provisional_outline",
    "next_phase",
    "stop_judgement"
  ],
  properties: {
    phase_result: {
      type: "string",
      enum: ["acquired", "integrated", "verified", "blocked"]
    },
    resolved_items: {
      type: "array",
      items: {
        type: "string"
      }
    },
    open_items: {
      type: "array",
      items: {
        type: "string"
      }
    },
    material_gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["gap", "needs_observation", "suggested_operator"],
        properties: {
          gap: {
            type: "string"
          },
          needs_observation: {
            type: "boolean"
          },
          suggested_operator: {
            type: "string",
            enum: ["web_search", "open_page", "find_in_page", "none"]
          }
        }
      }
    },
    contradictions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["a", "b", "material"],
        properties: {
          a: {
            type: "string"
          },
          b: {
            type: "string"
          },
          material: {
            type: "boolean"
          }
        }
      }
    },
    evidence_digest: {
      type: "string"
    },
    provisional_outline: {
      type: "string"
    },
    next_phase: {
      type: "string",
      enum: ["acquire", "integrate", "verify", "finalize"]
    },
    stop_judgement: {
      type: "object",
      additionalProperties: false,
      required: ["done", "reason", "marginal_value"],
      properties: {
        done: {
          type: "boolean"
        },
        reason: {
          type: "string"
        },
        marginal_value: {
          type: "string",
          enum: ["high", "medium", "low"]
        }
      }
    }
  }
} as const;

export const FORUM_WORK_TURN_SOFT_TIMEOUT_MS = 120_000;
export const FORUM_WORK_TURN_HARD_TIMEOUT_MS = 240_000;
export const FORUM_CHECKPOINT_TURN_SOFT_TIMEOUT_MS = 30_000;
export const FORUM_CHECKPOINT_TURN_HARD_TIMEOUT_MS = 60_000;
export const FORUM_IDLE_STEER_AFTER_MS = 30_000;
export const FORUM_BROADENING_SEARCH_THRESHOLD = 3;
export const FORUM_MAX_ITERATIONS = 4;
export const FORUM_TOTAL_LOOP_BUDGET_MS = 8 * 60_000;

export type ForumLoopTraceContext = {
  messageId: string;
  threadId: string;
  sessionIdentity: string;
  workloadKind: string;
  modelProfile: string;
  runtimeContractVersion: string;
};

type ForumLoopClient = Pick<
  CodexAppServerClient,
  "runTextTurn" | "runJsonTurn" | "startCompaction"
>;

export function createInitialForumLoopState(): ForumLoopState {
  return {
    phase: "acquire",
    iteration: 0,
    resolvedItems: [],
    openItems: [],
    materialGaps: [],
    contradictions: [],
    evidenceDigest: "",
    provisionalOutline: "",
    stopJudgement: {
      done: false,
      reason: "initial phase",
      marginalValue: "high"
    },
    termination: null
  };
}

export async function runForumExplorationLoop(input: {
  logger: Logger;
  codexClient: ForumLoopClient;
  request: HarnessRequest;
  threadId: string;
  sessionMetadata: HarnessTurnSessionMetadata;
  trace: ForumLoopTraceContext;
}): Promise<{
  response: HarnessResponse;
  observations: TurnObservations;
  loopState: ForumLoopState;
}> {
  const startedAt = Date.now();
  let state = createInitialForumLoopState();
  let observations: TurnObservations = {
    observed_public_urls: []
  };

  while (
    state.phase !== "finalize" &&
    state.iteration < FORUM_MAX_ITERATIONS &&
    Date.now() - startedAt < FORUM_TOTAL_LOOP_BUDGET_MS
  ) {
    let loopStage: "work" | "checkpoint" = "work";
    const targetIteration = state.iteration + 1;
    traceForumLoopEvent(input.trace, "phase_started", {
      phase: state.phase,
      iteration: targetIteration
    });

    try {
      const workTurn = await input.codexClient.runTextTurn({
        threadId: input.threadId,
        inputPayload: buildForumWorkTurnPayload(input.request, state),
        allowExternalFetch: input.request.capabilities.allow_external_fetch,
        sessionMetadata: input.sessionMetadata,
        timeoutMs: FORUM_WORK_TURN_HARD_TIMEOUT_MS,
        ...(buildForumTurnControlPolicy(state.phase) === null
          ? {}
          : {
              controlPolicy: buildForumTurnControlPolicy(state.phase)
            })
      });
      observations = mergeTurnObservations(observations, workTurn.observations);
      traceForumLoopEvent(input.trace, "phase_completed", {
        phase: state.phase,
        iteration: targetIteration,
        observed_public_urls: workTurn.observations.observed_public_urls
      });

      loopStage = "checkpoint";
      const checkpointTurn = await input.codexClient.runJsonTurn<ForumCheckpoint>({
        threadId: input.threadId,
        inputPayload: buildForumCheckpointPayload(input.request, state),
        allowExternalFetch: input.request.capabilities.allow_external_fetch,
        outputSchema: forumCheckpointJsonSchema,
        parser: (value) => forumCheckpointSchema.parse(value),
        sessionMetadata: input.sessionMetadata,
        timeoutMs: FORUM_CHECKPOINT_TURN_HARD_TIMEOUT_MS
      });
      observations = mergeTurnObservations(
        observations,
        checkpointTurn.observations
      );
      traceForumLoopEvent(input.trace, "checkpoint_received", {
        phase: state.phase,
        iteration: targetIteration,
        checkpoint: summarizeCheckpoint(checkpointTurn.response)
      });
      state = reduceForumLoopState(state, checkpointTurn.response);
      traceForumLoopEvent(input.trace, "next_phase_selected", {
        phase: state.phase,
        iteration: state.iteration,
        next_phase: state.phase,
        stop_judgement_done: state.stopJudgement.done
      });
    } catch (error) {
      const termination = buildForumTermination(loopStage, error);
      input.logger.warn(
        {
          error: termination.detail,
          messageId: input.trace.messageId,
          threadId: input.threadId,
          phase: state.phase,
          iteration: targetIteration,
          terminationReason: termination.reason
        },
        "forum exploration loop terminated early; forcing finalize"
      );
      state = {
        ...state,
        phase: "finalize",
        termination
      };
      traceForumLoopEvent(input.trace, "termination_set", {
        phase: state.phase,
        iteration: targetIteration,
        termination
      });
    }

    if (state.iteration > 0 && state.iteration % 2 === 0) {
      traceForumLoopEvent(input.trace, "compaction_started", {
        iteration: state.iteration
      });
      await input.codexClient.startCompaction(input.threadId);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  if (
    state.phase !== "finalize" &&
    (state.iteration >= FORUM_MAX_ITERATIONS ||
      elapsedMs >= FORUM_TOTAL_LOOP_BUDGET_MS)
  ) {
    const termination: ForumTermination = {
      reason:
        state.iteration >= FORUM_MAX_ITERATIONS
          ? "iteration_budget_exhausted"
          : "time_budget_exhausted",
      detail:
        state.iteration >= FORUM_MAX_ITERATIONS
          ? "iteration budget exhausted"
          : "time budget exhausted"
    };
    state = {
      ...state,
      phase: "finalize",
      termination
    };
    traceForumLoopEvent(input.trace, "termination_set", {
      phase: state.phase,
      iteration: state.iteration,
      termination
    });
  }

  const finalTurn = await runForumFinalizeTurn({
    codexClient: input.codexClient,
    request: input.request,
    state,
    threadId: input.threadId,
    sessionMetadata: input.sessionMetadata,
    trace: input.trace
  });
  observations = mergeTurnObservations(observations, finalTurn.observations);

  return {
    response: finalTurn.response,
    observations,
    loopState: state
  };
}

export async function runForumFinalizeTurn(input: {
  codexClient: Pick<CodexAppServerClient, "runJsonTurn">;
  request: HarnessRequest;
  state: ForumLoopState;
  threadId: string;
  sessionMetadata: HarnessTurnSessionMetadata;
  trace?: ForumLoopTraceContext;
  retryKind?: "initial" | "output_safety_retry";
}): Promise<{
  response: HarnessResponse;
  observations: TurnObservations;
}> {
  if (input.retryKind === "output_safety_retry" && input.trace) {
    traceForumLoopEvent(input.trace, "retry_finalize_started", {
      iteration: input.state.iteration,
      termination: input.state.termination
    });
  }

  return input.codexClient.runJsonTurn<HarnessResponse>({
    threadId: input.threadId,
    inputPayload: buildForumFinalizePayload(input.request, input.state),
    allowExternalFetch: input.request.capabilities.allow_external_fetch,
    outputSchema: harnessResponseJsonSchema,
    parser: (value) => harnessResponseSchema.parse(value),
    sessionMetadata: input.sessionMetadata,
    timeoutMs: FORUM_WORK_TURN_HARD_TIMEOUT_MS
  });
}

export function buildForumFinalizePayload(
  request: HarnessRequest,
  state: ForumLoopState
): Record<string, unknown> {
  return {
    ...request,
    forum_loop: {
      kind: "finalize",
      phase: "finalize",
      iteration: state.iteration,
      prior_state: summarizeForumLoopState(state),
      instruction:
        "Produce the final user-facing answer now, using the accumulated exploration state and the thread history. Keep the normal harness response contract."
    }
  };
}

export function mergeTurnObservations(
  left: TurnObservations,
  right: TurnObservations
): TurnObservations {
  return {
    observed_public_urls: dedupeStrings([
      ...left.observed_public_urls,
      ...right.observed_public_urls
    ])
  };
}

function buildForumWorkTurnPayload(
  request: HarnessRequest,
  state: ForumLoopState
): Record<string, unknown> {
  return {
    ...request,
    forum_loop: {
      kind: "exploration_work",
      phase: state.phase,
      iteration: state.iteration + 1,
      timeout_budget_ms: {
        soft: FORUM_WORK_TURN_SOFT_TIMEOUT_MS,
        hard: FORUM_WORK_TURN_HARD_TIMEOUT_MS
      },
      prior_state: summarizeForumLoopState(state),
      phase_instructions: getForumPhaseInstructions(state.phase),
      completion_criteria:
        "Advance the current phase only far enough to improve the next checkpoint. Do not produce the final user-facing answer yet. End with a brief plain-text internal work note."
    }
  };
}

function buildForumCheckpointPayload(
  request: HarnessRequest,
  state: ForumLoopState
): Record<string, unknown> {
  return {
    ...request,
    forum_loop: {
      kind: "checkpoint",
      phase: state.phase,
      iteration: state.iteration + 1,
      timeout_budget_ms: {
        soft: FORUM_CHECKPOINT_TURN_SOFT_TIMEOUT_MS,
        hard: FORUM_CHECKPOINT_TURN_HARD_TIMEOUT_MS
      },
      prior_state: summarizeForumLoopState(state),
      instruction:
        "Using the research and reasoning accumulated in this thread so far, return only the checkpoint JSON object. Do not broaden scope. Do not write the final user-facing answer here."
    }
  };
}

function buildForumTurnControlPolicy(
  phase: ForumExplorationPhase
): TurnControlPolicy | null {
  switch (phase) {
    case "acquire":
      return {
        idleSteer: {
          afterMs: FORUM_IDLE_STEER_AFTER_MS,
          prompt:
            "Focus only on the unresolved material gaps already listed in forum_loop.prior_state. Do not broaden the search space. Prefer opening specific pages or extracting passages over issuing new broad searches."
        },
        broadeningSearchSteer: {
          searchActionThreshold: FORUM_BROADENING_SEARCH_THRESHOLD,
          prompt:
            "You have already searched broadly enough for this phase. Stop broadening search. Use the existing material gaps and the evidence already gathered to move toward a checkpoint-ready state."
        }
      };
    case "integrate":
      return {
        idleSteer: {
          afterMs: FORUM_IDLE_STEER_AFTER_MS,
          prompt:
            "Stop gathering new material. Integrate the evidence already gathered into a coherent structure for the next checkpoint."
        }
      };
    case "verify":
      return {
        idleSteer: {
          afterMs: FORUM_IDLE_STEER_AFTER_MS,
          prompt:
            "Verify the current conclusion against the existing evidence and only seek targeted counter-evidence for explicit unresolved gaps."
        },
        broadeningSearchSteer: {
          searchActionThreshold: FORUM_BROADENING_SEARCH_THRESHOLD,
          prompt:
            "Verification should stay narrow. Do not broaden search. Re-check the current conclusion against existing gaps and contradictions only."
        }
      };
    case "finalize":
      return null;
  }
}

function summarizeForumLoopState(state: ForumLoopState): Record<string, unknown> {
  return {
    phase: state.phase,
    iteration: state.iteration,
    resolved_items: state.resolvedItems,
    open_items: state.openItems,
    material_gaps: state.materialGaps.map((gap) => ({
      gap: gap.gap,
      needs_observation: gap.needsObservation,
      suggested_operator: gap.suggestedOperator
    })),
    contradictions: state.contradictions,
    evidence_digest: state.evidenceDigest,
    provisional_outline: state.provisionalOutline,
    stop_judgement: {
      done: state.stopJudgement.done,
      reason: state.stopJudgement.reason,
      marginal_value: state.stopJudgement.marginalValue
    },
    ...(state.termination === null
      ? {}
      : {
          termination: {
            reason: state.termination.reason,
            detail: state.termination.detail
          }
        })
  };
}

function getForumPhaseInstructions(phase: ForumExplorationPhase): string[] {
  const base = [
    "Close material gaps instead of exploring broadly.",
    "Use external observation only when it materially improves the next checkpoint.",
    "Preserve citations and source candidates that may be useful in the final answer."
  ];

  switch (phase) {
    case "acquire":
      return [
        ...base,
        "Acquire missing public evidence for unresolved gaps.",
        "Search, open pages, and inspect specific passages only as needed."
      ];
    case "integrate":
      return [
        ...base,
        "Integrate the evidence already gathered into a coherent structure.",
        "Prefer synthesis over additional searching unless a material gap remains."
      ];
    case "verify":
      return [
        ...base,
        "Probe the current conclusion for contradictions or missing counter-evidence.",
        "Only return to targeted searching if verification reveals a material unresolved gap."
      ];
    case "finalize":
      return [
        ...base,
        "Prepare to produce the final answer from the gathered state."
      ];
  }
}

function reduceForumLoopState(
  previous: ForumLoopState,
  checkpoint: ForumCheckpoint
): ForumLoopState {
  const nextMaterialGaps = checkpoint.material_gaps.map((gap) => ({
    gap: gap.gap,
    needsObservation: gap.needs_observation,
    suggestedOperator: gap.suggested_operator
  }));
  const nextContradictions = checkpoint.contradictions.map((item) => ({
    a: item.a,
    b: item.b,
    material: item.material
  }));
  const nextStopJudgement: ForumStopJudgement = {
    done: checkpoint.stop_judgement.done,
    reason: checkpoint.stop_judgement.reason,
    marginalValue: checkpoint.stop_judgement.marginal_value
  };
  const shouldFinalize =
    checkpoint.next_phase === "finalize" || nextStopJudgement.done;

  return {
    phase: shouldFinalize ? "finalize" : checkpoint.next_phase,
    iteration: previous.iteration + 1,
    resolvedItems: dedupeStrings(checkpoint.resolved_items),
    openItems: dedupeStrings(checkpoint.open_items),
    materialGaps: nextMaterialGaps,
    contradictions: nextContradictions,
    evidenceDigest: checkpoint.evidence_digest.trim(),
    provisionalOutline: checkpoint.provisional_outline.trim(),
    stopJudgement: nextStopJudgement,
    termination: previous.termination
  };
}

function buildForumTermination(
  loopStage: "work" | "checkpoint",
  error: unknown
): ForumTermination {
  const detail =
    error instanceof Error ? error.message : "forum exploration failed";
  if (detail.includes("timed out")) {
    return {
      reason: "interrupt_timeout",
      detail
    };
  }

  return {
    reason: loopStage === "work" ? "work_turn_failed" : "checkpoint_failed",
    detail
  };
}

function summarizeCheckpoint(
  checkpoint: ForumCheckpoint
): Record<string, unknown> {
  return {
    phase_result: checkpoint.phase_result,
    next_phase: checkpoint.next_phase,
    stop_judgement_done: checkpoint.stop_judgement.done,
    material_gap_count: checkpoint.material_gaps.length,
    contradiction_count: checkpoint.contradictions.length
  };
}

function traceForumLoopEvent(
  trace: ForumLoopTraceContext,
  event:
    | "phase_started"
    | "phase_completed"
    | "checkpoint_received"
    | "next_phase_selected"
    | "termination_set"
    | "compaction_started"
    | "retry_finalize_started",
  payload: Record<string, unknown>
): void {
  appendRuntimeTrace("codex-app-server", event, {
    messageId: trace.messageId,
    threadId: trace.threadId,
    sessionIdentity: trace.sessionIdentity,
    workloadKind: trace.workloadKind,
    modelProfile: trace.modelProfile,
    runtimeContractVersion: trace.runtimeContractVersion,
    ...payload
  });
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
