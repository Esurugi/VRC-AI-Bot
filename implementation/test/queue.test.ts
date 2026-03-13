import test from "node:test";
import assert from "node:assert/strict";

import { OrderedMessageQueue } from "../src/queue/ordered-message-queue.js";

test("OrderedMessageQueue preserves snowflake order per key and deduplicates", async () => {
  const processed: string[] = [];
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const queue = new OrderedMessageQueue<{
    messageId: string;
    orderingKey: string;
  }>(async (item) => {
    processed.push(`${item.orderingKey}:${item.messageId}`);
    if (processed.length === 3) {
      resolveDone?.();
    }
  });

  queue.enqueue({ messageId: "3", orderingKey: "c1" });
  queue.enqueue({ messageId: "1", orderingKey: "c1" });
  queue.enqueue({ messageId: "2", orderingKey: "c1" });
  queue.enqueue({ messageId: "2", orderingKey: "c1" });

  await done;
  assert.deepEqual(processed, ["c1:1", "c1:2", "c1:3"]);
});

test("OrderedMessageQueue runs different keys concurrently while preserving in-key order", async () => {
  const started: string[] = [];
  const completed: string[] = [];
  let resolveFirstLane: (() => void) | undefined;
  const firstLaneReleased = new Promise<void>((resolve) => {
    resolveFirstLane = resolve;
  });
  let resolveSecondStart: (() => void) | undefined;
  const secondStart = new Promise<void>((resolve) => {
    resolveSecondStart = resolve;
  });
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const queue = new OrderedMessageQueue<{
    messageId: string;
    orderingKey: string;
  }>(
    async (item) => {
      started.push(`${item.orderingKey}:${item.messageId}`);
      if (item.orderingKey === "c2") {
        resolveSecondStart?.();
      }
      if (item.orderingKey === "c1" && item.messageId === "1") {
        await firstLaneReleased;
      }
      completed.push(`${item.orderingKey}:${item.messageId}`);
      if (completed.length === 3) {
        resolveDone?.();
      }
    },
    2
  );

  queue.enqueue({ messageId: "1", orderingKey: "c1" });
  queue.enqueue({ messageId: "2", orderingKey: "c1" });
  queue.enqueue({ messageId: "3", orderingKey: "c2" });

  await secondStart;
  assert.deepEqual(started, ["c1:1", "c2:3"]);

  resolveFirstLane?.();
  await done;

  assert.deepEqual(completed, ["c2:3", "c1:1", "c1:2"]);
});

test("OrderedMessageQueue allows re-enqueue of the same message after processing finishes", async () => {
  const processed: string[] = [];
  let resolveFirst: (() => void) | undefined;
  const firstDone = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  let resolveSecond: (() => void) | undefined;
  const secondDone = new Promise<void>((resolve) => {
    resolveSecond = resolve;
  });

  const queue = new OrderedMessageQueue<{
    messageId: string;
    orderingKey: string;
  }>(async (item) => {
    processed.push(`${item.orderingKey}:${item.messageId}:${processed.length}`);
    if (processed.length === 1) {
      resolveFirst?.();
    }
    if (processed.length === 2) {
      resolveSecond?.();
    }
  });

  queue.enqueue({ messageId: "1", orderingKey: "c1" });
  await firstDone;
  await new Promise((resolve) => setImmediate(resolve));
  queue.enqueue({ messageId: "1", orderingKey: "c1" });
  await secondDone;

  assert.deepEqual(processed, ["c1:1:0", "c1:1:1"]);
});
