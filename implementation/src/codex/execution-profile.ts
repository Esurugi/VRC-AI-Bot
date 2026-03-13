import type { ReasoningEffort } from "./generated/ReasoningEffort.js";
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_MODEL_PROFILE,
  FORUM_LONGFORM_CODEX_MODEL_PROFILE
} from "./session-policy.js";

export type CodexExecutionProfile = {
  model: string;
  reasoningEffort: ReasoningEffort | null;
};

export function resolveCodexExecutionProfile(
  modelProfile: string
): CodexExecutionProfile {
  switch (modelProfile) {
    case DEFAULT_CODEX_MODEL_PROFILE:
      return {
        model: DEFAULT_CODEX_MODEL,
        reasoningEffort: null
      };
    case FORUM_LONGFORM_CODEX_MODEL_PROFILE:
      return {
        model: DEFAULT_CODEX_MODEL,
        reasoningEffort: "high"
      };
    default:
      return {
        model: DEFAULT_CODEX_MODEL,
        reasoningEffort: null
      };
  }
}
