import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFailureNotice,
  buildPermanentFailureReply,
  splitPlainTextReplies
} from "../src/app/replies.js";

test("splitPlainTextReplies preserves long text by chunking instead of truncating", () => {
  const input = `${"あ".repeat(1200)}\n\n${"い".repeat(1200)}`;
  const chunks = splitPlainTextReplies(input);

  assert.equal(chunks.length, 2);
  assert.equal(chunks.join(""), input.replace(/\n\n/g, ""));
  assert.ok(chunks.every((chunk) => chunk.length <= 1900));
});

test("buildFailureNotice formats retry and terminal categories", () => {
  assert.equal(
    buildFailureNotice({
      category: "fetch_timeout",
      delayMs: 5 * 60_000
    }),
    "取得がタイムアウトしたため、5分後に再試行します。"
  );
  assert.equal(
    buildFailureNotice({
      category: "ai_processing_failed",
      delayMs: 2 * 60 * 60_000
    }),
    "AI処理に失敗したため、2時間後に再試行します。"
  );
  assert.equal(
    buildFailureNotice({
      category: "retry_limit_reached"
    }),
    "再試行上限に達したため処理を終了します。"
  );
});

test("buildPermanentFailureReply includes stage and category in diagnostics payload", () => {
  const reply = buildPermanentFailureReply({
    messageId: "message-1",
    placeMode: "chat",
    channelId: "channel-1",
    error: "timeout",
    stage: "dispatch",
    category: "ai_processing_failed"
  });

  assert.match(reply, /"type": "permanent_failure"/);
  assert.match(reply, /"message_id": "message-1"/);
  assert.match(reply, /"stage": "dispatch"/);
  assert.match(reply, /"category": "ai_processing_failed"/);
});
