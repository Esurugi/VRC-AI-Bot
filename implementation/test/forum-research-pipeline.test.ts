import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ForumResearchPipeline } from "../src/harness/forum-research-pipeline.js";
import type { HarnessRequest, HarnessResponse } from "../src/harness/contracts.js";
import {
  forumResearchPlanJsonSchema,
  forumResearchPlanSchema
} from "../src/forum-research/types.js";
import { SqliteStore } from "../src/storage/database.js";
import type {
  HarnessTurnSessionMetadata,
  TurnObservations
} from "../src/codex/app-server-client.js";

test("forumResearchPlan schema and JSON schema both allow zero worker tasks", () => {
  const parsed = forumResearchPlanSchema.parse({
    progress_notice: null,
    effective_user_text: null,
    worker_tasks: [],
    synthesis_brief: "brief",
    evidence_gaps: []
  });

  assert.deepEqual(parsed.worker_tasks, []);
  assert.equal(forumResearchPlanJsonSchema.properties.worker_tasks.minItems, 0);
});

test("ForumResearchPipeline keeps external fetch capability on streaming retry and appends observed public URLs", async () => {
  const fixture = createFixture({
    plan: {
      progress_notice: null,
      effective_user_text: null,
      worker_tasks: [],
      synthesis_brief: "brief",
      evidence_gaps: []
    },
    finalTurn: {
      error: "codex turn timed out after 1000ms"
    },
    streamingTurn: {
      response: "本文です。[1]\n補足します。",
      observations: {
        observed_public_urls: ["https://example.com/fresh-source"]
      }
    }
  });

  try {
    const result = await fixture.pipeline.run({
      request: createForumRequest(),
      threadId: "thread-main",
      sessionMetadata: createSessionMetadata()
    });

    assert.equal(result.primaryReplyAlreadySent, true);
    assert.equal(fixture.codexClient.streamingCalls.length, 1);
    assert.equal(fixture.codexClient.streamingCalls[0]?.allowExternalFetch, true);
    assert.deepEqual(result.response.sources_used, ["https://example.com/fresh-source"]);
  } finally {
    fixture.close();
  }
});

function createFixture(input: {
  plan: {
    progress_notice: string | null;
    effective_user_text: string | null;
    worker_tasks: unknown[];
    synthesis_brief: string;
    evidence_gaps: string[];
  };
  finalTurn: {
    response?: HarnessResponse;
    observations?: TurnObservations;
    error?: string;
  };
  streamingTurn: {
    response?: string | null;
    observations?: TurnObservations;
    error?: string;
  };
}) {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-forum-pipeline-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();

  const codexClient = new FakeCodexClient(input.finalTurn, input.streamingTurn);
  const planner = {
    async plan() {
      return input.plan;
    }
  };
  const pipeline = new ForumResearchPipeline(
    store,
    codexClient as never,
    planner as never,
    { warn() {}, debug() {} } as never
  );

  return {
    pipeline,
    codexClient,
    close() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

class FakeCodexClient {
  readonly streamingCalls: Array<{ allowExternalFetch: boolean; payload: unknown }> = [];

  constructor(
    private readonly finalTurn: {
      response?: HarnessResponse;
      observations?: TurnObservations;
      error?: string;
    },
    private readonly streamingTurn: {
      response?: string | null;
      observations?: TurnObservations;
      error?: string;
    }
  ) {}

  async startEphemeralThread(): Promise<string> {
    return "thread-ephemeral";
  }

  async closeEphemeralThread(): Promise<void> {
    return;
  }

  async runJsonTurn<T>(input: {
    inputPayload: unknown;
    parser: (value: unknown) => T;
  }): Promise<{ response: T; observations: TurnObservations }> {
    const payload = input.inputPayload as { kind?: string };
    if (payload.kind === "forum_research_planner") {
      return {
        response: input.parser({
          progress_notice: null,
          effective_user_text: null,
          worker_tasks: [],
          synthesis_brief: "brief",
          evidence_gaps: []
        }),
        observations: {
          observed_public_urls: []
        }
      };
    }

    if (this.finalTurn.error) {
      throw new Error(this.finalTurn.error);
    }

    return {
      response: input.parser(
        this.finalTurn.response ?? {
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
      observations: this.finalTurn.observations ?? {
        observed_public_urls: []
      }
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
    if (this.streamingTurn.error) {
      throw new Error(this.streamingTurn.error);
    }
    if (this.streamingTurn.response) {
      await input.callbacks?.onAgentMessageDelta?.(this.streamingTurn.response);
    }
    return {
      response: this.streamingTurn.response ?? null,
      observations: this.streamingTurn.observations ?? {
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
