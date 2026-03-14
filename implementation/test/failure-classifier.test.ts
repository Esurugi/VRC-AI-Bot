import assert from "node:assert/strict";
import test from "node:test";

import { FailureClassifier } from "../src/app/failure-classifier.js";

test("FailureClassifier marks timeout and service errors as transient with staged delays", () => {
  const classifier = new FailureClassifier();

  const timeoutDecision = classifier.classify(new Error("request timed out"), {
    stage: "fetch_or_resolve",
    attemptCount: 0,
    watchMode: "chat"
  });
  assert.equal(timeoutDecision.retryable, true);
  assert.equal(timeoutDecision.publicCategory, "fetch_timeout");
  assert.equal(timeoutDecision.delayMs, 5 * 60_000);

  const serviceDecision = classifier.classify(
    Object.assign(new Error("503 service unavailable"), { status: 503 }),
    {
      stage: "dispatch",
      attemptCount: 1,
      watchMode: "chat"
    }
  );
  assert.equal(serviceDecision.retryable, true);
  assert.equal(serviceDecision.publicCategory, "ai_processing_failed");
  assert.equal(serviceDecision.delayMs, 30 * 60_000);

  const forumTimeoutDecision = classifier.classify(new Error("request timed out"), {
    stage: "fetch_or_resolve",
    attemptCount: 0,
    watchMode: "forum_longform"
  });
  assert.equal(forumTimeoutDecision.retryable, true);
  assert.equal(forumTimeoutDecision.publicCategory, "fetch_timeout");
  assert.equal(forumTimeoutDecision.delayMs, 0);
});

test("FailureClassifier marks blocked or missing resources as permanent", () => {
  const classifier = new FailureClassifier();

  const blockedDecision = classifier.classify(new Error("blocked URL: file://secret.txt"), {
    stage: "fetch_or_resolve",
    attemptCount: 0,
    watchMode: "chat"
  });
  assert.equal(blockedDecision.retryable, false);
  assert.equal(blockedDecision.publicCategory, "public_page_unavailable");

  const missingDecision = classifier.classify(new Error("message no longer available"), {
    stage: "fetch_or_resolve",
    attemptCount: 0,
    watchMode: "chat"
  });
  assert.equal(missingDecision.retryable, false);
  assert.equal(missingDecision.publicCategory, "unsupported_place");

  const permissionDecision = classifier.classify(
    Object.assign(new Error("permission denied"), { status: 403 }),
    {
      stage: "dispatch",
      attemptCount: 0,
      watchMode: "chat"
    }
  );
  assert.equal(permissionDecision.retryable, false);
  assert.equal(permissionDecision.publicCategory, "permission_denied");
});

test("FailureClassifier stops retrying after three attempts or in post_response stage", () => {
  const classifier = new FailureClassifier();

  const exhausted = classifier.classify(new Error("app server unavailable"), {
    stage: "fetch_or_resolve",
    attemptCount: 3,
    watchMode: "chat"
  });
  assert.equal(exhausted.retryable, false);
  assert.equal(exhausted.publicCategory, "retry_limit_reached");

  const postResponse = classifier.classify(new Error("503 service unavailable"), {
    stage: "post_response",
    attemptCount: 0,
    watchMode: "chat"
  });
  assert.equal(postResponse.retryable, false);
  assert.equal(postResponse.publicCategory, "retry_limit_reached");
});

test("FailureClassifier treats forum planner timeout like other transient forum timeouts", () => {
  const classifier = new FailureClassifier();

  const decision = classifier.classify(
    Object.assign(new Error("forum research planner timed out: request timed out"), {
      code: "FORUM_RESEARCH_PLANNER_TIMEOUT"
    }),
    {
      stage: "fetch_or_resolve",
      attemptCount: 0,
      watchMode: "forum_longform"
    }
  );

  assert.equal(decision.retryable, true);
  assert.equal(decision.publicCategory, "fetch_timeout");
  assert.equal(decision.delayMs, 0);
});
