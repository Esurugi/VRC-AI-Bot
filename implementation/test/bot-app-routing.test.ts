import test from "node:test";
import assert from "node:assert/strict";

import { resolveKnowledgeIngestRouting } from "../src/app/bot-app.js";

test("resolveKnowledgeIngestRouting keeps manual knowledge saves in same place", () => {
  const routing = resolveKnowledgeIngestRouting({
    isThreadMessage: false,
    watchMode: "chat",
    replyMode: "same_place",
    hasMessageUrls: false
  });

  assert.deepEqual(routing, {
    kind: "same_place"
  });
});

test("resolveKnowledgeIngestRouting creates a public thread for url_watch root ingests", () => {
  const routing = resolveKnowledgeIngestRouting({
    isThreadMessage: false,
    watchMode: "url_watch",
    replyMode: "create_public_thread",
    hasMessageUrls: true
  });

  assert.deepEqual(routing, {
    kind: "create_public_thread"
  });
});
