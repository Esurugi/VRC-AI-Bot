import test from "node:test";
import assert from "node:assert/strict";

import { splitPlainTextReplies } from "../src/app/replies.js";

test("splitPlainTextReplies preserves long text by chunking instead of truncating", () => {
  const input = `${"あ".repeat(1200)}\n\n${"い".repeat(1200)}`;
  const chunks = splitPlainTextReplies(input);

  assert.equal(chunks.length, 2);
  assert.equal(chunks.join(""), input.replace(/\n\n/g, ""));
  assert.ok(chunks.every((chunk) => chunk.length <= 1900));
});
