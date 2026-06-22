import test from "node:test";
import assert from "node:assert/strict";

import { resolveCodexExecutionProfile } from "../../src/codex/execution-profile.js";
import {
  AMBIENT_ROOM_CHAT_CODEX_MODEL_PROFILE,
  CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE,
  CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE,
  DEFAULT_CODEX_MODEL_PROFILE,
  FORUM_LONGFORM_CODEX_MODEL_PROFILE
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

test("default and forum high profiles stay on gpt-5.5", () => {
  assert.deepEqual(resolveCodexExecutionProfile(DEFAULT_CODEX_MODEL_PROFILE), {
    model: "gpt-5.5",
    reasoningEffort: null
  });

  assert.deepEqual(resolveCodexExecutionProfile(FORUM_LONGFORM_CODEX_MODEL_PROFILE), {
    model: "gpt-5.5",
    reasoningEffort: "high"
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
