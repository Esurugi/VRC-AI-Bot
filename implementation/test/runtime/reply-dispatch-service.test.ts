import test from "node:test";
import assert from "node:assert/strict";

import {
  findAdminControlWatchLocation,
  resolveKnowledgeIngestRouting
} from "../../src/runtime/message/reply-dispatch-service.js";

test("knowledge ingest routing stays in place when reply mode is same_place", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: false,
      hasKnowledgeIngestFeature: true,
      replyMode: "same_place",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "same_place"
    }
  );
});

test("knowledge ingest routing creates a public thread for knowledge feature root shares", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: false,
      hasKnowledgeIngestFeature: true,
      replyMode: "create_public_thread",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "create_public_thread"
    }
  );
});

test("knowledge ingest routing follows knowledge feature instead of legacy mode", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: false,
      hasKnowledgeIngestFeature: true,
      replyMode: "create_public_thread",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "create_public_thread"
    }
  );
});

test("knowledge ingest routing ignores shared evidence without knowledge feature", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: false,
      hasKnowledgeIngestFeature: false,
      replyMode: "create_public_thread",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "same_place"
    }
  );
});

test("knowledge ingest routing stays in place for thread messages", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: true,
      hasKnowledgeIngestFeature: true,
      replyMode: "create_public_thread",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "same_place"
    }
  );
});

test("admin diagnostics target resolves from admin override feature", () => {
  const location = findAdminControlWatchLocation(
    [
      {
        guildId: "guild",
        channelId: "general",
        mode: "chat",
        defaultScope: "server_public",
        chatBehavior: "ambient_room_chat"
      },
      {
        guildId: "guild",
        channelId: "ops-root",
        mode: "chat",
        features: ["admin_override", "conversation"],
        defaultScope: "conversation_only",
        chatBehavior: "directed_help_chat"
      }
    ],
    "guild"
  );

  assert.equal(location?.channelId, "ops-root");
});
