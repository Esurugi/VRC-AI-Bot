import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ForumResearchPipeline } from "../src/harness/forum-research-pipeline.js";
import type { HarnessRequest } from "../src/harness/contracts.js";
import {
  promptRefinementArtifactJsonSchema,
  promptRefinementArtifactSchema,
  forumResearchSupervisorDecisionJsonSchema,
  forumResearchSupervisorDecisionSchema
} from "../src/forum-research/types.js";
import { SqliteStore } from "../src/storage/database.js";
import type {
  HarnessTurnSessionMetadata,
  TurnObservations
} from "../src/codex/app-server-client.js";

test("forumResearchSupervisorDecision schema and JSON schema both allow zero worker tasks", () => {
  const parsed = forumResearchSupervisorDecisionSchema.parse({
    progress_notice: null,
    worker_tasks: [],
    interrupts: [],
    next_action: "finalize",
    final_brief: "brief"
  });

  assert.deepEqual(parsed.worker_tasks, []);
  assert.equal(
    forumResearchSupervisorDecisionJsonSchema.properties.worker_tasks.minItems,
    0
  );
});

test("promptRefinementArtifact schema and JSON schema require refined prompt output", () => {
  const parsed = promptRefinementArtifactSchema.parse({
    refined_prompt: "supervisor 用の hidden prompt",
    progress_notice: null,
    prompt_rationale_summary: "要件を整理した"
  });

  assert.equal(parsed.refined_prompt, "supervisor 用の hidden prompt");
  assert.deepEqual(promptRefinementArtifactJsonSchema.required, [
    "refined_prompt",
    "progress_notice",
    "prompt_rationale_summary"
  ]);
});

test("ForumResearchPipeline keeps external fetch capability on streaming retry and appends observed public URLs", async () => {
  const fixture = createFixture({
    supervisorDecisions: [
      {
        progress_notice: null,
        worker_tasks: [],
        interrupts: [],
        next_action: "finalize",
        final_brief: "brief"
      }
    ],
    streamingTurns: [
      {
        error: "codex turn timed out after 1000ms"
      },
      {
        response: "本文です。[1]\n補足します。",
        observations: {
          observed_public_urls: ["https://example.com/fresh-source"]
        }
      }
    ]
  });

  try {
    const result = await fixture.pipeline.run({
      request: createForumRequest(),
      threadId: "thread-main",
      sessionMetadata: createSessionMetadata()
    });

    assert.equal(result.primaryReplyAlreadySent, true);
    assert.equal(fixture.codexClient.streamingCalls.length, 2);
    assert.equal(fixture.codexClient.streamingCalls[0]?.allowExternalFetch, true);
    assert.deepEqual(result.response.sources_used, ["https://example.com/fresh-source"]);
  } finally {
    fixture.close();
  }
});

test("ForumResearchPipeline treats final protocol errors as visible recovery and returns failure when streaming recovery is empty", async () => {
  const statuses: string[] = [];
  const fixture = createFixture({
    supervisorDecisions: [
      {
        progress_notice: null,
        worker_tasks: [],
        interrupts: [],
        next_action: "finalize",
        final_brief: "brief"
      }
    ],
    streamingTurns: [
      {
        error: "codex thread/read did not contain an agent message"
      },
      {
        response: null,
        observations: {
          observed_public_urls: []
        }
      }
    ]
  });

  try {
    const result = await fixture.pipeline.run({
      request: createForumRequest(),
      threadId: "thread-main",
      sessionMetadata: createSessionMetadata(),
      callbacks: {
        onRetryStatus(content) {
          statuses.push(content);
        }
      }
    });

    assert.equal(result.primaryReplyAlreadySent, false);
    assert.equal(result.response.outcome, "failure");
    assert.match(result.response.public_text ?? "", /再試行は完了できませんでした/);
    assert.equal(fixture.codexClient.streamingCalls.length, 2);
    assert.deepEqual(statuses, [
      "再試行しています。生成結果の受け取りで問題が起きたため、整理し直しています。"
    ]);
  } finally {
    fixture.close();
  }
});

test("ForumResearchPipeline surfaces terminal failure instead of throwing when output-safety retry hits a recoverable final-turn error", async () => {
  const statuses: string[] = [];
  const fixture = createFixture({
    supervisorDecisions: [
      {
        progress_notice: null,
        worker_tasks: [],
        interrupts: [],
        next_action: "finalize",
        final_brief: "brief"
      }
    ],
    streamingTurns: [
      {
        response: "本文です。",
        observations: {
          observed_public_urls: []
        }
      }
    ]
  });
  fixture.codexClient.streamingTurnError = "codex turn timed out after 1000ms";

  try {
    const result = await fixture.pipeline.runOutputSafetyRetry({
      request: createForumRequest(),
      threadId: "thread-main",
      sessionMetadata: createSessionMetadata(),
      state: {
        bundle: {
          evidenceItems: [],
          currentWorkerPackets: [],
          distinctSourceTarget: 8,
          distinctSources: [],
          sourceCatalog: []
        },
        persistedState: null,
        promptArtifact: {
          sessionIdentity: "forum:guild-1:thread-main",
          threadId: "thread-main",
          lastMessageId: "message-1",
          refinedPrompt: "forum supervisor hidden prompt",
          progressNotice: null,
          promptRationaleSummary: null
        },
        finalBrief: null
      },
      callbacks: {
        onRetryStatus(content) {
          statuses.push(content);
        }
      }
    });

    assert.equal(result.response.outcome, "failure");
    assert.match(result.response.public_text ?? "", /再生成は完了できませんでした/);
    assert.deepEqual(statuses, [
      "公開可能な根拠だけで答え直しています。少し待ってください。"
    ]);
    assert.equal(fixture.codexClient.streamingCalls.length, 1);
  } finally {
    fixture.close();
  }
});

test("ForumResearchPipeline persists prompt artifacts separately and reuses them on the same session", async () => {
  const fixture = createFixture({
    supervisorDecisions: [
      {
        progress_notice: null,
        worker_tasks: [],
        interrupts: [],
        next_action: "finalize",
        final_brief: "brief"
      },
      {
        progress_notice: null,
        worker_tasks: [],
        interrupts: [],
        next_action: "finalize",
        final_brief: "brief"
      }
    ],
    streamingTurns: [
      {
        response: "本文です。"
      },
      {
        response: "本文です。"
      }
    ]
  });

  try {
    const first = await fixture.pipeline.run({
      request: createForumRequest(),
      threadId: "thread-main",
      sessionMetadata: createSessionMetadata()
    });
    const second = await fixture.pipeline.run({
      request: createForumRequest(),
      threadId: "thread-main",
      sessionMetadata: createSessionMetadata()
    });

    assert.equal(first.primaryReplyAlreadySent, true);
    assert.equal(second.primaryReplyAlreadySent, true);
    assert.equal(first.state.promptArtifact.refinedPrompt, "forum supervisor hidden prompt");
    assert.equal(second.state.promptArtifact.refinedPrompt, "forum supervisor hidden prompt");
    assert.equal(fixture.promptRefiner.calls.length, 1);

    const savedArtifact = fixture.store.forumResearchPromptArtifacts.get(
      createSessionMetadata().sessionIdentity
    );
    assert.equal(savedArtifact?.refined_prompt, "forum supervisor hidden prompt");

    const evidenceState = fixture.store.forumResearchStates.get(
      createSessionMetadata().sessionIdentity
    );
    assert.equal(evidenceState, null);
  } finally {
    fixture.close();
  }
});

function createFixture(input: {
  promptRefinement?:
    | {
        refined_prompt: string;
        progress_notice: string | null;
        prompt_rationale_summary: string | null;
      }
    | undefined;
  supervisorDecisions: Array<{
    progress_notice: string | null;
    worker_tasks: unknown[];
    interrupts: string[];
    next_action: "launch_workers" | "finalize";
    final_brief: string | null;
  }>;
  streamingTurns: Array<{
    response?: string | null;
    observations?: TurnObservations;
    error?: string;
  }>;
}) {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-forum-pipeline-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();

  const codexClient = new FakeCodexClient(input.streamingTurns);
  const promptRefiner = {
    calls: [] as unknown[],
    async refine(refinerInput: unknown) {
      this.calls.push(refinerInput);
      return (
        input.promptRefinement ?? {
          refined_prompt: "forum supervisor hidden prompt",
          progress_notice: "論点を整えています。",
          prompt_rationale_summary: "raw request を supervisor 向けに再構成"
        }
      );
    }
  };
  const supervisor = {
    async decide() {
      const decision = input.supervisorDecisions.shift();
      if (!decision) {
        throw new Error("missing fake supervisor decision");
      }
      return decision;
    }
  };
  const pipeline = new ForumResearchPipeline(
    store,
    codexClient as never,
    promptRefiner as never,
    supervisor as never,
    { warn() {}, debug() {} } as never
  );

  return {
    pipeline,
    codexClient,
    promptRefiner,
    store,
    close() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

class FakeCodexClient {
  readonly streamingCalls: Array<{ allowExternalFetch: boolean; payload: unknown }> = [];
  streamingTurnError: string | null = null;

  constructor(
    private readonly streamingTurns: Array<{
      response?: string | null;
      observations?: TurnObservations;
      error?: string;
    }>
  ) {}

  async startEphemeralThread(): Promise<string> {
    return "thread-ephemeral";
  }

  async closeEphemeralThread(): Promise<void> {
    return;
  }

  async runJsonTurn<T>(input: {
    parser: (value: unknown) => T;
  }): Promise<{ response: T; observations: TurnObservations }> {
    return {
      response: input.parser(
        {
          outcome: "chat_reply",
          repo_write_intent: false,
          public_text: "fallback",
          reply_mode: "same_place",
          target_thread_id: null,
          selected_source_ids: [],
          sources_used: [],
          knowledge_writes: [],
          diagnostics: {
            notes: null
          },
          sensitivity_raise: "none"
        }
      ),
      observations: {
        observed_public_urls: []
      }
    };
  }

  async startJsonTurn<T>(_input: {
    parser: (value: unknown) => T;
  }): Promise<{
    turnId: string | null;
    completion: Promise<{ response: T; observations: TurnObservations; turnId: string | null }>;
    interrupt: () => Promise<void>;
  }> {
    return {
      turnId: "turn-1",
      completion: Promise.resolve({
        response: _input.parser({
          worker_id: "worker-1",
          subquestion: "subquestion",
          evidence_items: [
            {
              claim: "claim",
              source_urls: ["https://example.com/source"]
            }
          ],
          citations: [
            {
              url: "https://example.com/source",
              claim: "claim"
            }
          ]
        }),
        observations: {
          observed_public_urls: []
        },
        turnId: "turn-1"
      }),
      interrupt: async () => undefined
    };
  }

  async runStreamingTextTurn(input: {
    allowExternalFetch: boolean;
    inputPayload: unknown;
    callbacks?: {
      onAgentMessageDelta?: (delta: string) => Promise<void> | void;
    };
  }): Promise<{ response: string | null; observations: TurnObservations }> {
    this.streamingCalls.push({
      allowExternalFetch: input.allowExternalFetch,
      payload: input.inputPayload
    });
    const turn = this.streamingTurns.shift() ?? {
      response: null,
      observations: {
        observed_public_urls: []
      }
    };
    if (this.streamingTurnError ?? turn.error) {
      throw new Error(this.streamingTurnError ?? turn.error);
    }
    if (turn.response) {
      await input.callbacks?.onAgentMessageDelta?.(turn.response);
    }
    return {
      response: turn.response ?? null,
      observations: turn.observations ?? {
        observed_public_urls: []
      }
    };
  }
}

function createForumRequest(): HarnessRequest {
  return {
    place: {
      guild_id: "guild-1",
      root_channel_id: "forum-parent-1",
      thread_id: "thread-main",
      mode: "forum_longform",
      place_type: "forum_post_thread",
      scope: "conversation_only"
    },
    actor: {
      role: "user",
      user_id: "user-1"
    },
    task: {
      kind: "route_message",
      phase: "answer",
      retry_context: null
    },
    capabilities: {
      allow_external_fetch: true,
      allow_knowledge_write: false,
      allow_moderation: false
    },
    override_context: {
      active: false,
      same_actor: false,
      started_by: null,
      started_at: null,
      flags: {
        allow_playwright_headed: false,
        allow_playwright_persistent: false,
        allow_prompt_injection_test: false,
        suspend_violation_counter_for_current_thread: false,
        allow_external_fetch_in_private_context_without_private_terms: false
      }
    },
    message: {
      id: "message-1",
      content: "調べて",
      urls: [],
      created_at: "2026-03-14T00:00:00.000Z"
    },
    available_context: {
      fetchable_public_urls: [],
      blocked_urls: [],
      discord_runtime_facts_path: null,
      thread_context: {
        kind: "plain_thread",
        source_message_id: null,
        known_source_urls: [],
        reply_thread_id: "thread-main",
        root_channel_id: "forum-parent-1"
      },
      recent_messages: []
    }
  } as never;
}

function createSessionMetadata(): HarnessTurnSessionMetadata {
  return {
    sessionIdentity: "forum:guild-1:thread-main",
    workloadKind: "forum_longform",
    modelProfile: "forum:gpt-5.4:high",
    runtimeContractVersion: "v1"
  };
}
