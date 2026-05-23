import test from "node:test";
import assert from "node:assert/strict";

import {
  FORUM_RESEARCH_WORKER_MAX_SOURCES,
  FORUM_RESEARCH_WORKER_MIN_SOURCES,
  forumResearchSupervisorDecisionJsonSchema,
  forumResearchWorkerTaskSchema
} from "../../src/forum-research/types.js";

test("forum supervisor JSON schema uses the same source limits as the parser", () => {
  const workerTaskProperties =
    forumResearchSupervisorDecisionJsonSchema.properties.worker_tasks.items
      .properties;

  assert.deepEqual(workerTaskProperties.min_sources, {
    type: "integer",
    minimum: FORUM_RESEARCH_WORKER_MIN_SOURCES,
    maximum: FORUM_RESEARCH_WORKER_MAX_SOURCES
  });
  assert.deepEqual(workerTaskProperties.max_sources, {
    type: "integer",
    minimum: FORUM_RESEARCH_WORKER_MIN_SOURCES,
    maximum: FORUM_RESEARCH_WORKER_MAX_SOURCES
  });

  assert.equal(
    forumResearchWorkerTaskSchema.safeParse({
      worker_id: "recent_research",
      question: "recent RAG research",
      search_focus: "recent high-signal papers",
      must_cover: [],
      min_sources: FORUM_RESEARCH_WORKER_MIN_SOURCES,
      max_sources: FORUM_RESEARCH_WORKER_MAX_SOURCES + 1
    }).success,
    false
  );
});
