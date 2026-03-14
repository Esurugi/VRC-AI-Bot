import type { WatchMode } from "../domain/types.js";

export type FailureStage = "fetch_or_resolve" | "dispatch" | "post_response";

export type FailurePublicCategory =
  | "public_page_unavailable"
  | "fetch_timeout"
  | "permission_denied"
  | "unsupported_place"
  | "ai_processing_failed"
  | "retry_limit_reached";

export type FailureDecision = {
  retryable: boolean;
  publicCategory: FailurePublicCategory;
  adminErrorPayload: string;
  delayMs: number | null;
  terminalReason: string | null;
};

type FailureContext = {
  stage: FailureStage;
  attemptCount: number;
  watchMode: WatchMode;
};

const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
const FORUM_RETRY_DELAYS_MS = [0, 15_000] as const;

export class FailureClassifier {
  classify(error: unknown, context: FailureContext): FailureDecision {
    const details = normalizeError(error);
    const adminErrorPayload = details.message;

    if (isPermissionFailure(details)) {
      return {
        retryable: false,
        publicCategory: "permission_denied",
        adminErrorPayload,
        delayMs: null,
        terminalReason: "permission_denied"
      };
    }

    if (isUnsupportedPlaceFailure(details)) {
      return {
        retryable: false,
        publicCategory: "unsupported_place",
        adminErrorPayload,
        delayMs: null,
        terminalReason: "unsupported_place"
      };
    }

    if (isPublicPageUnavailableFailure(details, context.stage)) {
      return {
        retryable: false,
        publicCategory: "public_page_unavailable",
        adminErrorPayload,
        delayMs: null,
        terminalReason: "public_page_unavailable"
      };
    }

    if (isTransientFailure(details)) {
      if (isForumPlannerTimeoutFailure(details)) {
        return {
          retryable: false,
          publicCategory: "ai_processing_failed",
          adminErrorPayload,
          delayMs: null,
          terminalReason: "forum_planner_timeout"
        };
      }

      const retryDelays =
        context.watchMode === "forum_longform" ? FORUM_RETRY_DELAYS_MS : RETRY_DELAYS_MS;
      const delayMs = retryDelays[context.attemptCount];
      if (delayMs == null || context.stage === "post_response") {
        return {
          retryable: false,
          publicCategory: "retry_limit_reached",
          adminErrorPayload,
          delayMs: null,
          terminalReason:
            context.stage === "post_response"
              ? "post_response_non_retryable"
              : "retry_limit_reached"
        };
      }

      return {
        retryable: true,
        publicCategory: isTimeoutFailure(details)
          ? "fetch_timeout"
          : "ai_processing_failed",
        adminErrorPayload,
        delayMs,
        terminalReason: null
      };
    }

    return {
      retryable: false,
      publicCategory: "ai_processing_failed",
      adminErrorPayload,
      delayMs: null,
      terminalReason: "non_retryable_runtime_failure"
    };
  }
}

type NormalizedError = {
  message: string;
  status: number | null;
  code: string | number | null;
};

function normalizeError(error: unknown): NormalizedError {
  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      status?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : candidate.cause instanceof Error
          ? candidate.cause.message
          : String(error);
    const status = typeof candidate.status === "number" ? candidate.status : null;
    const code =
      typeof candidate.code === "string" || typeof candidate.code === "number"
        ? candidate.code
        : null;
    return {
      message,
      status,
      code
    };
  }

  return {
    message: String(error),
    status: null,
    code: null
  };
}

function isPermissionFailure(error: NormalizedError): boolean {
  return (
    error.status === 403 ||
    error.message.includes("403") ||
    error.message.toLowerCase().includes("permission denied")
  );
}

function isUnsupportedPlaceFailure(error: NormalizedError): boolean {
  return (
    error.message.includes("watch location not found") ||
    error.message.includes("message no longer available") ||
    error.message.includes("channel no longer available") ||
    error.message.includes("thread no longer available") ||
    error.message.includes("Unknown Message") ||
    error.message.includes("Unknown Channel") ||
    error.message.includes("scope violation")
  );
}

function isPublicPageUnavailableFailure(
  error: NormalizedError,
  stage: FailureStage
): boolean {
  if (stage !== "fetch_or_resolve") {
    return false;
  }

  const lowered = error.message.toLowerCase();
  return (
    error.status === 404 ||
    lowered.includes("404") ||
    lowered.includes("blocked url") ||
    lowered.includes("blocked_urls") ||
    lowered.includes("localhost") ||
    lowered.includes(".local") ||
    lowered.includes("private ip") ||
    lowered.includes("private url") ||
    lowered.includes("not publicly reachable") ||
    lowered.includes("file:") ||
    lowered.includes("data:") ||
    lowered.includes("javascript:")
  );
}

function isTransientFailure(error: NormalizedError): boolean {
  return isTimeoutFailure(error) || isServiceUnavailableFailure(error);
}

function isTimeoutFailure(error: NormalizedError): boolean {
  const lowered = error.message.toLowerCase();
  return (
    error.code === "ETIMEDOUT" ||
    lowered.includes("timeout") ||
    lowered.includes("timed out")
  );
}

function isForumPlannerTimeoutFailure(error: NormalizedError): boolean {
  if (!isTimeoutFailure(error)) {
    return false;
  }

  return (
    error.code === "FORUM_RESEARCH_PLANNER_TIMEOUT" ||
    error.message.includes("forum research planner timed out")
  );
}

function isServiceUnavailableFailure(error: NormalizedError): boolean {
  const lowered = error.message.toLowerCase();
  return (
    error.status === 429 ||
    error.status === 500 ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504 ||
    lowered.includes("429") ||
    lowered.includes("502") ||
    lowered.includes("503") ||
    lowered.includes("504") ||
    lowered.includes("service unavailable") ||
    lowered.includes("app server unavailable") ||
    lowered.includes("connection reset") ||
    lowered.includes("econnrefused") ||
    lowered.includes("econnreset")
  );
}
