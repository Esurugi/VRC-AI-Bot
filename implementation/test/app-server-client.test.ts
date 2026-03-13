import assert from "node:assert/strict";
import test from "node:test";

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
