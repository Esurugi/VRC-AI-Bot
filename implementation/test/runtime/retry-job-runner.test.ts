import assert from "node:assert/strict";
import test from "node:test";

import { RetryJobRunner } from "../../src/runtime/scheduling/retry-job-runner.js";

test("retry runner polls due jobs without deleting forum retry rows by legacy place_mode", async () => {
  let pollCount = 0;
  const runner = new RetryJobRunner(
    {
      watchLocations: [],
      runtime: {
        maxConcurrentKeys: 4,
        retryPollIntervalMs: 15_000,
        codexIdleCloseMs: 1_800_000,
        ambientSparseInterval: 5
      }
    } as never,
    {} as never,
    {} as never,
    {
      pollDueJobs: () => {
        pollCount += 1;
        return [];
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      error: () => {},
      debug: () => {}
    } as never
  );

  await runner.drainDueJobs();

  assert.equal(pollCount, 1);
});
