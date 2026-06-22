import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";

import {
  HarnessRunner,
  normalizeKnowledgeIngestResponse,
  resolveKnowledgePersistenceScope
} from "../../src/harness/harness-runner.js";
import type { HarnessResponse } from "../../src/harness/contracts.js";
import type { HarnessMessageContext } from "../../src/harness/harness-runner.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
import { SessionManager } from "../../src/codex/session-manager.js";
import { SessionPolicyResolver } from "../../src/codex/session-policy.js";
import { ForumResearchPromptRefiner } from "../../src/runtime/forum/forum-research-prompt-refiner.js";
import { ForumResearchSupervisor } from "../../src/runtime/forum/forum-research-supervisor.js";
import {
  asCodexClient,
  intent,
  response,
  ScriptedCodexClient
} from "../support/e2e-scripted-codex.js";

const logger = pino({ enabled: false });

test("knowledge thread follow-up knowledge ingest is coerced to chat reply", () => {
  const input = {
    envelope: {
      guildId: "guild-1",
      channelId: "thread-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "これも保存して https://example.com/update",
      urls: ["https://example.com/update"],
      receivedAt: "2026-04-13T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "root-1",
      mode: "url_watch",
      defaultScope: "server_public"
    },
    actorRole: "user",
    scope: "server_public"
  } satisfies HarnessMessageContext;

  const response = {
    outcome: "knowledge_ingest",
    repo_write_intent: false,
    public_text: null,
    reply_mode: "create_public_thread",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: ["https://example.com/update"],
    knowledge_writes: [
      {
        source_url: "https://example.com/update",
        canonical_url: "https://example.com/update",
        title: "Update",
        summary: "新しい要点",
        tags: ["update"],
        content_hash: null,
        normalized_text: null,
        source_kind: "webpage"
      }
    ],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none"
  } satisfies HarnessResponse;

  const normalized = normalizeKnowledgeIngestResponse(
    input,
    {
      kind: "knowledge_thread",
      sourceMessageId: "message-0",
      knownSourceUrls: ["https://example.com/original"],
      replyThreadId: "thread-1",
      rootChannelId: "root-1",
      knowledgeEntries: []
    },
    response,
    {
      fetchablePublicUrlCount: 1
    }
  );

  assert.equal(normalized.outcome, "chat_reply");
  assert.equal(normalized.reply_mode, "same_place");
  assert.equal(normalized.target_thread_id, null);
  assert.equal(normalized.public_text, null);
  assert.deepEqual(normalized.knowledge_writes, []);

  assert.equal(
    resolveKnowledgePersistenceScope(
      "server_public",
      input.watchLocation,
      {
        kind: "knowledge_thread",
        sourceMessageId: "message-0",
        knownSourceUrls: ["https://example.com/original"],
        replyThreadId: "thread-1",
        rootChannelId: "root-1",
        knowledgeEntries: []
      },
      normalized,
      1
    ),
    null
  );
});

test("root knowledge ingest can persist explicit save requests without pasted urls", () => {
  const input = {
    envelope: {
      guildId: "guild-1",
      channelId: "knowledge-root-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "このテーマを調べて知見として保存して",
      urls: [],
      receivedAt: "2026-04-13T00:00:00.000Z"
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "knowledge-root-1",
      mode: "chat",
      defaultScope: "server_public",
      features: ["knowledge_ingest", "conversation"]
    },
    actorRole: "user",
    scope: "server_public"
  } satisfies HarnessMessageContext;

  const response = {
    outcome: "knowledge_ingest",
    repo_write_intent: false,
    public_text: "保存しました。",
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: ["https://example.com/researched"],
    knowledge_writes: [
      {
        source_url: "https://example.com/researched",
        canonical_url: "https://example.com/researched",
        title: "調査済み知見",
        summary: "公開調査に基づく要点",
        tags: ["research"],
        content_hash: null,
        normalized_text: "公開調査に基づく要点",
        source_kind: "webpage"
      }
    ],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none"
  } satisfies HarnessResponse;

  const normalized = normalizeKnowledgeIngestResponse(
    input,
    {
      kind: "root_channel",
      sourceMessageId: null,
      knownSourceUrls: [],
      replyThreadId: null,
      rootChannelId: "knowledge-root-1",
      knowledgeEntries: []
    },
    response,
    {
      fetchablePublicUrlCount: 0
    }
  );

  assert.equal(normalized.reply_mode, "same_place");
  assert.equal(
    resolveKnowledgePersistenceScope(
      "server_public",
      input.watchLocation,
      {
        kind: "root_channel",
        sourceMessageId: null,
        knownSourceUrls: [],
        replyThreadId: null,
        rootChannelId: "knowledge-root-1",
        knowledgeEntries: []
      },
      normalized,
      0
    ),
    "server_public"
  );
});

test("routeMessage prefetches readable X status body before answer turn", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-x-prefetch-"));
  const store = new SqliteStore(join(tempDir, "bot.sqlite"), process.cwd());
  store.migrate();
  t.after(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const scriptedCodex = new ScriptedCodexClient();
  const codexClient = asCodexClient(scriptedCodex);
  const sessionPolicyResolver = new SessionPolicyResolver();
  const sessionManager = new SessionManager(store, codexClient, logger);
  const fetchedUrls: string[] = [];
  const runner = new HarnessRunner(
    store,
    codexClient,
    sessionPolicyResolver,
    sessionManager,
    new ForumResearchPromptRefiner(codexClient, logger),
    new ForumResearchSupervisor(codexClient, logger),
    logger,
    async (url) => {
      fetchedUrls.push(url);
      return {
        requestedUrl: url,
        finalUrl: url,
        canonicalUrl: url,
        public: true,
        status: 200,
        contentType: "application/json",
        title: "AM9:21 (@AM921543266)",
        text: "AM9:21 (@AM921543266): fetched post body"
      };
    }
  );

  scriptedCodex.enqueueIntent(
    intent({
      outcome: "knowledge_ingest",
      fetch: "message_urls",
      write: true
    })
  );
  scriptedCodex.enqueueAnswer({
    response: response({
      outcome: "knowledge_ingest",
      public_text: "取得しました。",
      sources_used: ["https://api.fxtwitter.com/2/status/2068900130397569096"],
      knowledge_writes: [
        {
          source_url: "https://api.fxtwitter.com/2/status/2068900130397569096",
          canonical_url: "https://api.fxtwitter.com/2/status/2068900130397569096",
          title: "AM9:21 (@AM921543266)",
          summary: "fetched post body",
          tags: ["x-twitter"],
          content_hash: null,
          normalized_text: "fetched post body",
          source_kind: "x_status"
        }
      ]
    })
  });

  await runner.routeMessage({
    actorRole: "user",
    scope: "server_public",
    watchLocation: {
      guildId: "guild-1",
      channelId: "knowledge-root-1",
      mode: "url_watch",
      defaultScope: "server_public",
      features: ["knowledge_ingest", "conversation"]
    },
    envelope: {
      guildId: "guild-1",
      channelId: "knowledge-root-1",
      messageId: "message-x",
      authorId: "user-1",
      placeType: "guild_text",
      rawPlaceType: "GuildText",
      content: "https://x.com/am921543266/status/2068900130397569096?s=46",
      urls: ["https://x.com/am921543266/status/2068900130397569096?s=46"],
      receivedAt: "2026-06-22T00:00:00.000Z"
    }
  });

  assert.deepEqual(fetchedUrls, [
    "https://api.fxtwitter.com/2/status/2068900130397569096"
  ]);
  assert.deepEqual(
    scriptedCodex.requests[1]?.available_context.public_source_facts,
    [
      {
        requested_url: "https://api.fxtwitter.com/2/status/2068900130397569096",
        final_url: "https://api.fxtwitter.com/2/status/2068900130397569096",
        canonical_url: "https://api.fxtwitter.com/2/status/2068900130397569096",
        status: 200,
        content_type: "application/json",
        title: "AM9:21 (@AM921543266)",
        text: "AM9:21 (@AM921543266): fetched post body"
      }
    ]
  );
});
