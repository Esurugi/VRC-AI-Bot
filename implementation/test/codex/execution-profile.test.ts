import test from "node:test";
import assert from "node:assert/strict";

import { resolveCodexExecutionProfile } from "../../src/codex/execution-profile.js";
import {
  AMBIENT_ROOM_CHAT_CODEX_MODEL_PROFILE,
  CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE,
  CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE,
  DEFAULT_CODEX_MODEL_PROFILE,
  FORUM_RESEARCH_WORKER_CODEX_MODEL_PROFILE,
  FORUM_RESEARCH_SUPERVISOR_CODEX_MODEL_PROFILE
} from "../../src/codex/session-policy.js";

test("chat and ambient profiles use gpt-5.5 with low reasoning", () => {
  assert.deepEqual(
    resolveCodexExecutionProfile(CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE),
    {
      model: "gpt-5.5",
      reasoningEffort: "low"
    }
  );

  assert.deepEqual(
    resolveCodexExecutionProfile(AMBIENT_ROOM_CHAT_CODEX_MODEL_PROFILE),
    {
      model: "gpt-5.5",
      reasoningEffort: "low"
    }
  );
});

test("default and role-specific forum profiles follow their configured models", () => {
  assert.deepEqual(resolveCodexExecutionProfile(DEFAULT_CODEX_MODEL_PROFILE), {
    model: "gpt-5.5",
    reasoningEffort: null
  });

  assert.deepEqual(resolveCodexExecutionProfile(FORUM_RESEARCH_SUPERVISOR_CODEX_MODEL_PROFILE), {
    model: "gpt-6-astra", reasoningEffort: "low"
  });
  assert.deepEqual(resolveCodexExecutionProfile(FORUM_RESEARCH_WORKER_CODEX_MODEL_PROFILE), {
    model: "gpt-5.6-luna", reasoningEffort: "xhigh"
  });
});

test("clear explanation gate uses Codex Spark with low reasoning", () => {
  assert.deepEqual(
    resolveCodexExecutionProfile(CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE),
    {
      model: "gpt-5.3-codex-spark",
      reasoningEffort: "low"
    }
  );
});
