import type { ReasoningEffort } from "./generated/ReasoningEffort.js";
import {
  AMBIENT_ROOM_CHAT_CODEX_MODEL_PROFILE,
  CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE,
  CLEAR_EXPLANATION_CODEX_MODEL_PROFILE,
  CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_MODEL_PROFILE,
  FORUM_LONGFORM_CODEX_MODEL_PROFILE,
  FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE
} from "./session-policy.js";

export type CodexExecutionProfile = {
  model: string;
  reasoningEffort: ReasoningEffort | null;
};

const MINI_CODEX_MODEL = "gpt-5.5-mini";
const CODEX_SPARK_MODEL = "gpt-5.3-codex-spark";

export function resolveCodexExecutionProfile(
  modelProfile: string
): CodexExecutionProfile {
  switch (modelProfile) {
    case DEFAULT_CODEX_MODEL_PROFILE:
      return {
        model: DEFAULT_CODEX_MODEL,
        reasoningEffort: null
      };
    case CHAT_CONVERSATION_LOW_CODEX_MODEL_PROFILE:
    case AMBIENT_ROOM_CHAT_CODEX_MODEL_PROFILE:
      return {
        model: MINI_CODEX_MODEL,
        reasoningEffort: "low"
      };
    case FORUM_LONGFORM_CODEX_MODEL_PROFILE:
    case CLEAR_EXPLANATION_CODEX_MODEL_PROFILE:
      return {
        model: DEFAULT_CODEX_MODEL,
        reasoningEffort: "high"
      };
    case FORUM_LONGFORM_LOW_CODEX_MODEL_PROFILE:
      return {
        model: DEFAULT_CODEX_MODEL,
        reasoningEffort: "low"
      };
    case CLEAR_EXPLANATION_GATE_CODEX_MODEL_PROFILE:
      return {
        model: CODEX_SPARK_MODEL,
        reasoningEffort: "low"
      };
    default:
      return {
        model: DEFAULT_CODEX_MODEL,
        reasoningEffort: null
      };
  }
}
