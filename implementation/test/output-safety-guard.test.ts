import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildHarnessRequest } from "../src/harness/build-harness-request.js";
import type { HarnessResponse } from "../src/harness/contracts.js";
import { OutputSafetyGuard } from "../src/harness/output-safety-guard.js";
import { SqliteStore } from "../src/storage/database.js";

test("OutputSafetyGuard allows server_public knowledge sources in a channel-family chat", () => {
  const fixture = createFixture();
  seedKnowledgeRecord(fixture.store, {
    recordId: "src-public",
    canonicalUrl: "https://openai.com/index/harness-engineering/",
    scope: "server_public",
    visibilityKey: "server_public:guild-1"
  });

  try {
    const evaluation = fixture.guard.evaluate({
      request: createRequest(),
      response: createResponse({
        selected_source_ids: ["src-public"],
        sources_used: ["src-public"]
      }),
      linkedKnowledgeSources: []
    });

    assert.equal(evaluation.decision, "allow");
    assert.equal(evaluation.reason, null);
  } finally {
    fixture.close();
  }
});

test("OutputSafetyGuard allows same-thread linked conversation_only sources", () => {
  const fixture = createFixture();
  seedKnowledgeRecord(fixture.store, {
    recordId: "src-thread",
    canonicalUrl: "https://example.com/private-thread-source",
    scope: "conversation_only",
    visibilityKey: "conversation_only:thread-1"
  });

  try {
    const evaluation = fixture.guard.evaluate({
      request: createRequest({
        scope: "conversation_only",
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-2",
          authorId: "user-1",
          placeType: "public_thread",
          rawPlaceType: "PublicThread",
          content: "続きは？",
          urls: [],
          receivedAt: "2026-03-10T00:00:01.000Z"
        },
        threadContext: {
          kind: "knowledge_thread",
          sourceMessageId: "source-1",
          knownSourceUrls: ["https://example.com/private-thread-source"],
          replyThreadId: "thread-1",
          rootChannelId: "channel-1"
        }
      }),
      response: createResponse({
        selected_source_ids: ["src-thread"],
        sources_used: ["src-thread"]
      }),
      linkedKnowledgeSources: [
        {
          sourceId: "src-thread",
          scope: "conversation_only",
          canonicalUrl: "https://example.com/private-thread-source"
        }
      ]
    });

    assert.equal(evaluation.decision, "allow");
  } finally {
    fixture.close();
  }
});

test("OutputSafetyGuard retries blocked or private URL sources and refuses on the second pass", () => {
  const fixture = createFixture();

  try {
    const firstEvaluation = fixture.guard.evaluate({
      request: createRequest({
        envelope: {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-3",
          authorId: "user-1",
          placeType: "chat_channel",
          rawPlaceType: "GuildText",
          content: "https://localhost/test",
          urls: ["https://localhost/test"],
          receivedAt: "2026-03-10T00:00:02.000Z"
        }
      }),
      response: createResponse({
        sources_used: ["https://localhost/test"]
      }),
      linkedKnowledgeSources: []
    });
    const secondEvaluation = fixture.guard.evaluate({
      request: createRequest({
        envelope: {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-3",
          authorId: "user-1",
          placeType: "chat_channel",
          rawPlaceType: "GuildText",
          content: "https://localhost/test",
          urls: ["https://localhost/test"],
          receivedAt: "2026-03-10T00:00:02.000Z"
        }
      }),
      response: createResponse({
        sources_used: ["https://localhost/test"]
      }),
      linkedKnowledgeSources: [],
      retryCount: 1
    });

    assert.equal(firstEvaluation.decision, "retry");
    assert.equal(secondEvaluation.decision, "refuse");
  } finally {
    fixture.close();
  }
});

test("OutputSafetyGuard rejects raw URLs that are only visible through a knowledge record", () => {
  const fixture = createFixture();
  seedKnowledgeRecord(fixture.store, {
    recordId: "src-public",
    canonicalUrl: "https://openai.com/index/harness-engineering/",
    scope: "server_public",
    visibilityKey: "server_public:guild-1"
  });

  try {
    const evaluation = fixture.guard.evaluate({
      request: createRequest(),
      response: createResponse({
        selected_source_ids: ["src-public"],
        sources_used: ["https://openai.com/index/harness-engineering/"]
      }),
      linkedKnowledgeSources: []
    });

    assert.equal(evaluation.decision, "retry");
    assert.match(evaluation.reason ?? "", /source url is not visible/);
    assert.deepEqual(
      evaluation.disallowedSources,
      ["https://openai.com/index/harness-engineering/"]
    );
  } finally {
    fixture.close();
  }
});

test("OutputSafetyGuard allows explicit fetchable public URLs", () => {
  const fixture = createFixture();

  try {
    const evaluation = fixture.guard.evaluate({
      request: createRequest({
        envelope: {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-fetchable",
          authorId: "user-1",
          placeType: "chat_channel",
          rawPlaceType: "GuildText",
          content: "この記事を見て https://openai.com/index/harness-engineering/",
          urls: ["https://openai.com/index/harness-engineering/"],
          receivedAt: "2026-03-10T00:00:03.000Z"
        }
      }),
      response: createResponse({
        sources_used: ["https://openai.com/index/harness-engineering/"]
      }),
      linkedKnowledgeSources: []
    });

    assert.equal(evaluation.decision, "allow");
    assert.equal(evaluation.reason, null);
  } finally {
    fixture.close();
  }
});

test("OutputSafetyGuard allows same-turn observed public URLs", () => {
  const fixture = createFixture();

  try {
    const evaluation = fixture.guard.evaluate({
      request: createRequest(),
      response: createResponse({
        sources_used: ["https://openai.com/index/harness-engineering/"]
      }),
      linkedKnowledgeSources: [],
      observedPublicUrls: ["https://openai.com/index/harness-engineering/"]
    });

    assert.equal(evaluation.decision, "allow");
    assert.equal(evaluation.reason, null);
  } finally {
    fixture.close();
  }
});

test("OutputSafetyGuard allows forum public research URLs without exact observed-url match", () => {
  const fixture = createFixture();

  try {
    const evaluation = fixture.guard.evaluate({
      request: createRequest({
        scope: "conversation_only",
        watchLocation: {
          guildId: "guild-1",
          channelId: "forum-parent-1",
          mode: "forum_longform",
          defaultScope: "conversation_only"
        },
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-forum-1",
          authorId: "user-1",
          placeType: "forum_post_thread",
          rawPlaceType: "PublicThread",
          content: "論じて",
          urls: [],
          receivedAt: "2026-03-10T00:00:04.000Z"
        },
        allowExternalFetch: true
      }),
      response: createResponse({
        sources_used: [
          "https://www.britannica.com/topic/Sunni",
          "https://www.cfr.org/conference-calls/tensions-between-saudi-arabia-and-iran"
        ]
      }),
      linkedKnowledgeSources: [],
      observedPublicUrls: ["https://www.britannica.com/topic/Sunni"]
    });

    assert.equal(evaluation.decision, "allow");
    assert.equal(evaluation.reason, null);
  } finally {
    fixture.close();
  }
});

test("OutputSafetyGuard still rejects blocked or non-public URLs in forum public research", () => {
  const fixture = createFixture();

  try {
    const evaluation = fixture.guard.evaluate({
      request: createRequest({
        scope: "conversation_only",
        watchLocation: {
          guildId: "guild-1",
          channelId: "forum-parent-1",
          mode: "forum_longform",
          defaultScope: "conversation_only"
        },
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-forum-2",
          authorId: "user-1",
          placeType: "forum_post_thread",
          rawPlaceType: "PublicThread",
          content: "論じて",
          urls: [],
          receivedAt: "2026-03-10T00:00:05.000Z"
        },
        allowExternalFetch: true
      }),
      response: createResponse({
        sources_used: ["file:///tmp/private.txt"]
      }),
      linkedKnowledgeSources: []
    });

    assert.equal(evaluation.decision, "retry");
    assert.match(evaluation.reason ?? "", /blocked or non-public source url/);
  } finally {
    fixture.close();
  }
});

test("OutputSafetyGuard rejects opaque and non-http source markers", () => {
  const fixture = createFixture();

  try {
    const fileEvaluation = fixture.guard.evaluate({
      request: createRequest(),
      response: createResponse({
        sources_used: ["file:///tmp/private.txt"]
      }),
      linkedKnowledgeSources: []
    });
    const fakeScriptEvaluation = fixture.guard.evaluate({
      request: createRequest(),
      response: createResponse({
        sources_used: [".agents/skills/public-source-fetch/scripts/fetch-public-source.ts"]
      }),
      linkedKnowledgeSources: []
    });
    const opaqueEvaluation = fixture.guard.evaluate({
      request: createRequest(),
      response: createResponse({
        sources_used: ["arbitrary source marker"]
      }),
      linkedKnowledgeSources: [],
      retryCount: 1
    });

    assert.equal(fileEvaluation.decision, "retry");
    assert.match(fileEvaluation.reason ?? "", /blocked or non-public source url/);
    assert.deepEqual(fileEvaluation.disallowedSources, ["file:///tmp/private.txt"]);
    assert.equal(fakeScriptEvaluation.decision, "retry");
    assert.match(fakeScriptEvaluation.reason ?? "", /unrecognized source marker/);
    assert.deepEqual(fakeScriptEvaluation.disallowedSources, [
      ".agents/skills/public-source-fetch/scripts/fetch-public-source.ts"
    ]);
    assert.equal(opaqueEvaluation.decision, "refuse");
    assert.match(opaqueEvaluation.reason ?? "", /unrecognized source marker/);
    assert.deepEqual(opaqueEvaluation.disallowedSources, ["arbitrary source marker"]);
  } finally {
    fixture.close();
  }
});

function createFixture(): {
  store: SqliteStore;
  guard: OutputSafetyGuard;
  close: () => void;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-output-safety-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();

  return {
    store,
    guard: new OutputSafetyGuard(store),
    close() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function createRequest(
  overrides: Partial<Parameters<typeof buildHarnessRequest>[0]> = {}
) {
  return buildHarnessRequest({
    actorRole: "user",
    scope: "channel_family",
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "chat",
      defaultScope: "channel_family"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "こんにちは",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    taskKind: "route_message",
    ...overrides
  });
}

function createResponse(
  overrides: Partial<HarnessResponse> = {}
): HarnessResponse {
  return {
    outcome: "chat_reply",
    repo_write_intent: false,
    public_text: "ok",
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [],
    knowledge_writes: [],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none",
    ...overrides
  };
}

function seedKnowledgeRecord(
  store: SqliteStore,
  input: {
    recordId: string;
    canonicalUrl: string;
    scope: "server_public" | "channel_family" | "conversation_only";
    visibilityKey: string;
  }
): void {
  const createdAt = "2026-03-10T00:00:00.000Z";
  store.knowledgeRecords.insert({
    recordId: input.recordId,
    canonicalUrl: input.canonicalUrl,
    domain: new URL(input.canonicalUrl).hostname,
    title: "seed title",
    summary: "seed summary",
    tags: ["seed"],
    scope: input.scope,
    visibilityKey: input.visibilityKey,
    contentHash: `hash-${input.recordId}`,
    createdAt
  });
  store.knowledgeArtifacts.upsert({
    recordId: input.recordId,
    finalUrl: input.canonicalUrl,
    snapshotPath: "artifacts/snapshot.md",
    screenshotPath: null,
    networkLogPath: null
  });
  store.knowledgeSourceTexts.upsert({
    recordId: input.recordId,
    normalizedText: "seed normalized text",
    sourceKind: "summary",
    capturedAt: createdAt
  });
}
