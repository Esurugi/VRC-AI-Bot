import test from "node:test";
import assert from "node:assert/strict";

import { resolveKnowledgeIngestRouting } from "../../src/runtime/message/reply-dispatch-service.js";

test("knowledge ingest routing stays in place for thread follow-ups", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: true,
      watchMode: "url_watch",
      replyMode: "create_public_thread",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "same_place"
    }
  );
});

test("knowledge ingest routing creates a public thread only for url watch root shares", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: false,
      watchMode: "url_watch",
      replyMode: "create_public_thread",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "create_public_thread"
    }
  );
});

test("knowledge ingest routing ignores shared evidence outside url watch", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: false,
      watchMode: "chat",
      replyMode: "create_public_thread",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "same_place"
    }
  );
});
