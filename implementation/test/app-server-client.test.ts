import assert from "node:assert/strict";
import test from "node:test";

import type { HarnessRequest } from "../src/harness/contracts.js";
import {
  CodexAppServerClient,
  HARNESS_DEVELOPER_INSTRUCTIONS,
  __testOnly
} from "../src/codex/app-server-client.js";

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

test("extractObservedPublicUrlsFromTurnItems accepts public URLs opened by web search items", () => {
  const observedUrls = __testOnly.extractObservedPublicUrlsFromTurnItems(
    [
      {
        type: "webSearch",
        id: "search-1",
        query: "latest harness engineering",
        action: {
          type: "openPage",
          url: "https://openai.com/index/harness-engineering/"
        }
      },
      {
        type: "webSearch",
        id: "search-2",
        query: "ignored",
        action: {
          type: "findInPage",
          url: "https://example.com/path#fragment",
          pattern: "foo"
        }
      }
    ],
    true,
    REPO_CWD
  );

  assert.deepEqual(observedUrls, [
    "https://example.com/path",
    PUBLIC_URL
  ]);
});

test("extractObservedPublicUrlsFromNotificationParams accepts web search items from item/completed notifications", () => {
  const observedUrls = __testOnly.extractObservedPublicUrlsFromNotificationParams(
    {
      item: {
        type: "webSearch",
        id: "search-1",
        query: "latest harness engineering",
        action: {
          type: "openPage",
          url: "https://openai.com/index/harness-engineering/"
        }
      },
      threadId: "thread-1",
      turnId: "turn-1"
    },
    true,
    REPO_CWD
  );

  assert.deepEqual(observedUrls, [PUBLIC_URL]);
});

test("extractObservedPublicUrlsFromNotificationParams returns empty when notification does not carry an item", () => {
  const observedUrls = __testOnly.extractObservedPublicUrlsFromNotificationParams(
    {
      threadId: "thread-1",
      turnId: "turn-1"
    },
    true,
    REPO_CWD
  );

  assert.deepEqual(observedUrls, []);
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

test("buildTurnSteerParams uses expectedTurnId and text input", () => {
  const params = __testOnly.buildTurnSteerParams({
    threadId: "thread-1",
    turnId: "turn-1",
    prompt: "Narrow focus."
  });

  assert.deepEqual(params, {
    threadId: "thread-1",
    expectedTurnId: "turn-1",
    input: [
      {
        type: "text",
        text: "Narrow focus.",
        text_elements: []
      }
    ]
  });
});

test("extractWebSearchActionTypeFromNotificationParams returns search action types", () => {
  assert.equal(
    __testOnly.extractWebSearchActionTypeFromNotificationParams({
      item: {
        type: "webSearch",
        action: {
          type: "search",
          query: "latest harness engineering"
        }
      }
    }),
    "search"
  );
  assert.equal(
    __testOnly.extractWebSearchActionTypeFromNotificationParams({
      item: {
        type: "webSearch",
        action: {
          type: "openPage",
          url: PUBLIC_URL
        }
      }
    }),
    "openPage"
  );
});

test("HARNESS_DEVELOPER_INSTRUCTIONS describes forum prompt refiner, supervisor, workers, and forum research context", () => {
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /output_safety and place\.mode is forum_longform .* fresh public research now/i
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /input kind is forum_research_prompt_refiner/i
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /input kind is forum_research_supervisor/i
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /input kind is forum_research_worker/i
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /forum_research_context.*persisted evidence facts/i
  );
  assert.match(HARNESS_DEVELOPER_INSTRUCTIONS, /forum_research_context\.refined_prompt/i);
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /input kind is forum_research_streaming_final, return only the final user-facing japanese answer body as plain text/i
  );
  assert.doesNotMatch(HARNESS_DEVELOPER_INSTRUCTIONS, /forum_loop/i);
  assert.doesNotMatch(HARNESS_DEVELOPER_INSTRUCTIONS, /min_body_chars/i);
});

test("interruptTurn times out best-effort control requests and clears pending state", async () => {
  const client = new CodexAppServerClient(
    "codex app-server",
    REPO_CWD,
    null,
    {
      debug() {},
      warn() {},
      info() {},
      error() {}
    } as never
  );
  const writes: string[] = [];
  (client as unknown as { process: unknown }).process = {
    stdin: {
      write(chunk: string) {
        writes.push(chunk);
      }
    }
  };

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    queueMicrotask(() => callback());
    return 0 as never;
  }) as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout =
    (() => {}) as unknown as typeof globalThis.clearTimeout;

  try {
    await assert.rejects(
      client.interruptTurn("thread-1", "turn-1"),
      /turn\/interrupt timed out/i
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assert.equal(writes.length, 1);
  assert.equal(
    (client as unknown as { pending: Map<number, unknown> }).pending.size,
    0
  );
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
