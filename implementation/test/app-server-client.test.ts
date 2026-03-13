import assert from "node:assert/strict";
import test from "node:test";

import type { HarnessRequest } from "../src/harness/contracts.js";
import { __testOnly } from "../src/codex/app-server-client.js";

const REPO_CWD = "D:/project/VRC-AI-Bot";
const PUBLIC_URL = "https://openai.com/index/harness-engineering/";

test("findLatestTurnSnapshot keeps observed public URLs scoped to the requested turn", () => {
  const snapshot = __testOnly.findLatestTurnSnapshot(
    {
      thread: {
        turns: [
          {
            id: "turn-1",
            items: [
              createAgentMessage('{"outcome":"chat_reply","public_text":"old"}'),
              createFetchCommandExecution()
            ]
          },
          {
            id: "turn-2",
            items: [createAgentMessage('{"outcome":"chat_reply","public_text":"new"}')]
          }
        ]
      }
    },
    "turn-2",
    true,
    REPO_CWD
  );

  assert.equal(snapshot.lastAgentMessage, '{"outcome":"chat_reply","public_text":"new"}');
  assert.deepEqual(snapshot.observedPublicUrls, []);
});

test("extractObservedPublicUrlsFromTurnItems accepts only authoritative public-source-fetch executions", () => {
  const observedUrls = __testOnly.extractObservedPublicUrlsFromTurnItems(
    [
      createFetchCommandExecution(),
      createFetchCommandExecution({
        command:
          "echo .agents/skills/public-source-fetch/scripts/fetch-public-source.ts --url https://openai.com/index/harness-engineering/"
      }),
      createFetchCommandExecution({
        cwd: "D:/project/Other"
      })
    ],
    true,
    REPO_CWD
  );

  assert.deepEqual(observedUrls, [PUBLIC_URL]);
});

test("extractObservedPublicUrlsFromTurnItems does not reconfirm when external fetch is disabled", () => {
  const observedUrls = __testOnly.extractObservedPublicUrlsFromTurnItems(
    [createFetchCommandExecution()],
    false,
    REPO_CWD
  );

  assert.deepEqual(observedUrls, []);
});

test("buildTurnStartParams sets high reasoning effort for forum profile", () => {
  const params = __testOnly.buildTurnStartParams({
    threadId: "thread-1",
    requestPayload: createHarnessRequest(),
    outputSchema: {
      type: "object"
    },
    executionProfile: {
      model: "gpt-5.4",
      reasoningEffort: "high"
    }
  });

  assert.equal(params.model, "gpt-5.4");
  assert.equal(params.effort, "high");
});

test("buildTurnStartParams omits effort for default profile", () => {
  const params = __testOnly.buildTurnStartParams({
    threadId: "thread-1",
    requestPayload: createHarnessRequest(),
    outputSchema: {
      type: "object"
    },
    executionProfile: {
      model: "gpt-5.4",
      reasoningEffort: null
    }
  });

  assert.equal(params.model, "gpt-5.4");
  assert.equal("effort" in params, false);
});

function createAgentMessage(text: string) {
  return {
    type: "agentMessage",
    id: "agent-1",
    text,
    phase: null
  };
}

function createFetchCommandExecution(
  overrides: {
    command?: string;
    cwd?: string;
    aggregatedOutput?: string;
    exitCode?: number | null;
  } = {}
) {
  return {
    type: "commandExecution",
    id: "cmd-1",
    command:
      overrides.command ??
      'node --import tsx .agents/skills/public-source-fetch/scripts/fetch-public-source.ts --url "https://openai.com/index/harness-engineering/"',
    cwd: overrides.cwd ?? REPO_CWD,
    processId: null,
    status: "completed",
    commandActions: [],
    aggregatedOutput:
      overrides.aggregatedOutput ??
      JSON.stringify({
        requestedUrl: PUBLIC_URL,
        finalUrl: PUBLIC_URL,
        canonicalUrl: PUBLIC_URL,
        public: true,
        status: 200
      }),
    exitCode: overrides.exitCode ?? 0,
    durationMs: 10
  };
}

function createHarnessRequest(): HarnessRequest {
  return {
    request_id: "request-1",
    source: {
      adapter: "discord",
      event: "message_create"
    },
    actor: {
      user_id: "user-1",
      role: "user"
    },
    place: {
      guild_id: "guild-1",
      channel_id: "channel-1",
      root_channel_id: "channel-1",
      thread_id: null,
      mode: "chat",
      place_type: "chat_channel",
      scope: "channel_family"
    },
    message: {
      id: "message-1",
      content: "こんにちは",
      urls: [],
      created_at: "2026-03-10T00:00:00.000Z"
    },
    capabilities: {
      allow_external_fetch: false,
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
    available_context: {
      thread_context: {
        kind: "root_channel",
        source_message_id: null,
        known_source_urls: [],
        reply_thread_id: null,
        root_channel_id: "channel-1"
      },
      discord_runtime_facts_path: null,
      fetchable_public_urls: [],
      blocked_urls: [],
      recent_messages: []
    },
    task: {
      kind: "route_message",
      phase: "answer",
      retry_context: null
    }
  };
}
