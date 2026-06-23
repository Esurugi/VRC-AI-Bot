import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FailureClassifier } from "../../src/app/failure-classifier.js";
import { NOOP_BOT_MODERATION_INTEGRATION } from "../../src/app/moderation-integration.js";
import type { RetrySchedulerService } from "../../src/app/retry-scheduler-service.js";
import type { TurnObservations } from "../../src/codex/app-server-client.js";
import { SessionManager } from "../../src/codex/session-manager.js";
import { SessionPolicyResolver } from "../../src/codex/session-policy.js";
import type { ModerationExecutor } from "../../src/discord/moderation-executor.js";
import type {
  AppConfig,
  MessageEnvelope,
  WatchLocationConfig
} from "../../src/domain/types.js";
import { HarnessRunner } from "../../src/harness/harness-runner.js";
import { ForumResearchPromptRefiner } from "../../src/runtime/forum/forum-research-prompt-refiner.js";
import { ForumResearchSupervisor } from "../../src/runtime/forum/forum-research-supervisor.js";
import { ForumFirstTurnPreprocessor } from "../../src/runtime/forum/forum-first-turn-preprocessor.js";
import { FeatureThreadService } from "../../src/runtime/thread/feature-thread-service.js";
import { ChatEngagementPolicy } from "../../src/runtime/chat/chat-engagement-policy.js";
import { RecentChatHistoryService } from "../../src/runtime/chat/recent-chat-history-service.js";
import {
  buildClearExplanationQuestionGatewayRedirectNotice,
  CLEAR_EXPLANATION_DECLINE_NOTICE,
  ClearExplanationRoutingGate
} from "../../src/runtime/clear-explanation/clear-explanation-routing-gate.js";
import { MessageProcessingService } from "../../src/runtime/message/message-processing-service.js";
import { ReplyDispatchService } from "../../src/runtime/message/reply-dispatch-service.js";
import type { QueuedMessage } from "../../src/runtime/types.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
import {
  FakeDiscordWorld,
  createFakeMessage,
  type FakeDiscordAttachment,
  type FakeDiscordChannel,
  type FakeDiscordEvent
} from "../support/fake-discord-sink.js";
import {
  ScriptedCodexClient,
  asCodexClient,
  intent,
  response
} from "../support/e2e-scripted-codex.js";

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
} as never;

const CLEAR_EXPLANATION_ROOT_CHANNEL_ID = "1507630781479260230";
const STRUCTURED_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const RAW_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAC0lEQVR42mP8z8AABQMBgY8n8N8AAAAASUVORK5CYII=";
const FIRST_TURN_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8dOnSfwAJigNfR4Cw5QAAAABJRU5ErkJggg==";
const RETRY_TURN_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QzwAEjDAGjWQJxwAAAABJRU5ErkJggg==";

test("AE-E2E-01 url_watch root URL creates one public knowledge thread and sends the public summary there", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: "url-watch-root"
  });

  workflow.codex.enqueueIntent(
    intent({
      outcome: "knowledge_ingest",
      fetch: "message_urls",
      write: true
    })
  );
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "knowledge_ingest",
      public_text: "共有用の要約です。",
      reply_mode: "create_public_thread",
      sources_used: ["https://example.com/shared"],
      knowledge_writes: [
        {
          source_url: "https://example.com/shared",
          canonical_url: "https://example.com/shared",
          title: "Shared Source",
          summary: "共有用の要約です。",
          tags: ["shared"],
          content_hash: null,
          normalized_text: null,
          source_kind: "webpage",
          evidence_fact_ids: [genericFactId("https://example.com/shared")]
        }
      ]
    })
  });

  await workflow.processMessage({
    id: "message-url-1",
    channel: root,
    content: "https://example.com/shared",
    urls: ["https://example.com/shared"],
    watchLocation: urlWatchLocation()
  });

  const createThreadEvents = workflow.eventsOf("createThread");
  const sendEvents = workflow.eventsOf("send");
  const replyEvents = workflow.eventsOf("reply");

  assert.equal(createThreadEvents.length, 1);
  assert.equal(sendEvents.length, 1);
  assert.equal(replyEvents.length, 0);
  assert.equal(sendEvents[0]?.channelId, createThreadEvents[0]?.threadId);
  assert.match(sendEvents[0]?.content ?? "", /共有用の要約/);
  assert.ok(
    workflow.indexOf(createThreadEvents[0]) < workflow.indexOf(sendEvents[0]),
    "public thread must be created before the summary is sent into it"
  );
});

test("knowledge_ingest feature with chat mode still creates public thread and persists URL ingest", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: "knowledge-chat-root"
  });

  workflow.codex.enqueueIntent(
    intent({
      outcome: "knowledge_ingest",
      fetch: "message_urls",
      write: true
    })
  );
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "knowledge_ingest",
      public_text: "feature based summary",
      reply_mode: "create_public_thread",
      sources_used: ["https://example.com/feature-knowledge"],
      knowledge_writes: [
        {
          source_url: "https://example.com/feature-knowledge",
          canonical_url: "https://example.com/feature-knowledge",
          title: "Feature Knowledge",
          summary: "feature based summary",
          tags: ["feature"],
          content_hash: "feature-knowledge-hash",
          normalized_text: "feature based summary",
          source_kind: "webpage",
          evidence_fact_ids: [
            genericFactId("https://example.com/feature-knowledge")
          ]
        }
      ]
    })
  });

  await workflow.processMessage({
    id: "message-feature-knowledge",
    channel: root,
    content: "https://example.com/feature-knowledge",
    urls: ["https://example.com/feature-knowledge"],
    watchLocation: knowledgeFeatureChatLocation()
  });

  const createThreadEvents = workflow.eventsOf("createThread");
  assert.equal(createThreadEvents.length, 1);
  assert.deepEqual(
    workflow.store.sourceLinks
      .listForSourceMessage("message-feature-knowledge")
      .map((link) => link.reply_thread_id),
    [createThreadEvents[0]?.threadId]
  );
});

test("AE-E2E-02 chat root URL remains same-place conversation and does not create a knowledge thread", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: "chat-root"
  });

  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: "会話として受け取りました。",
      sources_used: []
    })
  });

  await workflow.processMessage({
    id: "message-chat-url",
    channel: root,
    content: "このURLどう思う？ https://example.com/chat",
    urls: ["https://example.com/chat"],
    watchLocation: chatLocation(),
    mentionsBot: true
  });

  assert.equal(workflow.eventsOf("createThread").length, 0);
  assert.equal(workflow.eventsOf("send").length, 0);
  assert.deepEqual(
    workflow.eventsOf("reply").map((event) => ({
      channelId: event.channelId,
      content: event.content
    })),
    [
      {
        channelId: "chat-root",
        content: "会話として受け取りました。"
      }
    ]
  );
});

test("AE-E2E-02 hostile knowledge_ingest on chat root does not create a thread or persist knowledge", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: "chat-root"
  });

  workflow.codex.enqueueIntent(
    intent({
      outcome: "knowledge_ingest",
      fetch: "message_urls",
      write: true
    })
  );
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "knowledge_ingest",
      public_text: "通常チャットでは会話として扱います。",
      reply_mode: "create_public_thread",
      sources_used: ["https://example.com/chat"],
      knowledge_writes: [
        {
          source_url: "https://example.com/chat",
          canonical_url: "https://example.com/chat",
          title: "Chat URL",
          summary: "通常チャットの URL は自動保存しません。",
          tags: [],
          content_hash: "chat-url-hash",
          normalized_text: "通常チャットの URL は自動保存しません。",
          source_kind: "webpage"
        }
      ]
    })
  });

  await workflow.processMessage({
    id: "message-chat-hostile-ingest",
    channel: root,
    content: "このURLどう思う？ https://example.com/chat",
    urls: ["https://example.com/chat"],
    watchLocation: chatLocation(),
    mentionsBot: true
  });

  assert.equal(workflow.eventsOf("createThread").length, 0);
  assert.deepEqual(
    workflow.store.sourceLinks.listForSourceMessage("message-chat-hostile-ingest"),
    []
  );
  assert.deepEqual(
    workflow.eventsOf("reply").map((event) => event.channelId),
    ["chat-root"]
  );
});

test("AE-E2E-03 knowledge thread follow-up retries no-reply and becomes visible in the same thread", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: "url-watch-root"
  });
  const thread = workflow.world.createThread({
    id: "knowledge-thread",
    parent: root
  });
  seedKnowledgeThread(workflow.store, thread.id);

  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "ignore",
      public_text: null,
      reply_mode: "no_reply"
    })
  });
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: "同じスレッドで追記に返答します。"
    })
  });

  await workflow.processMessage({
    id: "message-follow-up",
    channel: thread,
    content: "<@bot-user> この点も補足して",
    urls: [],
    watchLocation: urlWatchLocation(),
    placeType: "public_thread",
    mentionsBot: true
  });

  assert.deepEqual(
    workflow.codex.requests.map((request) => request.task.retry_context?.kind ?? request.task.phase),
    ["intent", "answer", "knowledge_followup_non_silent"]
  );
  assert.deepEqual(
    workflow.codex.requests.map(
      (request) => request.available_context.chat_engagement?.trigger_kind ?? null
    ),
    ["direct_mention", "direct_mention", "direct_mention"]
  );
  assert.deepEqual(
    workflow.eventsOf("reply").map((event) => ({
      channelId: event.channelId,
      content: event.content
    })),
    [
      {
        channelId: thread.id,
        content: "同じスレッドで追記に返答します。"
      }
    ]
  );
});

test("directed knowledge_ingest thread without source binding is exposed as missing_or_stale and does not stay silent", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: "url-watch-root"
  });
  const thread = workflow.world.createThread({
    id: "missing-binding-thread",
    parent: root
  });

  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "ignore",
      public_text: null,
      reply_mode: "no_reply"
    })
  });
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "ignore",
      public_text: null,
      reply_mode: "no_reply"
    })
  });

  await workflow.processMessage({
    id: "message-missing-binding-follow-up",
    channel: thread,
    content: "このスレッドの元ネタをもう一度説明して",
    urls: [],
    watchLocation: urlWatchLocation(),
    placeType: "public_thread",
    replyToBot: true
  });

  assert.deepEqual(
    workflow.codex.requests.map((request) => request.task.retry_context?.kind ?? request.task.phase),
    ["intent", "answer", "knowledge_followup_non_silent"]
  );
  assert.deepEqual(
    workflow.codex.requests.map(
      (request) => request.available_context.chat_engagement?.trigger_kind ?? null
    ),
    ["reply_to_bot", "reply_to_bot", "reply_to_bot"]
  );
  assert.deepEqual(
    workflow.codex.requests.map((request) => request.available_context.thread_context.kind),
    [
      "missing_or_stale_knowledge_thread",
      "missing_or_stale_knowledge_thread",
      "missing_or_stale_knowledge_thread"
    ]
  );
  assert.deepEqual(
    workflow.codex.requests.map(
      (request) => request.available_context.thread_context.known_source_urls
    ),
    [[], [], []]
  );
  assert.deepEqual(
    workflow.eventsOf("reply").map((event) => ({
      channelId: event.channelId,
      content: event.content
    })),
    [
      {
        channelId: thread.id,
        content:
          "このスレッドへの追撃応答を生成できませんでした。必要なら同じ依頼をもう一度送ってください。"
      }
    ]
  );
});

test("knowledge thread non-directed follow-up does not retry no-reply", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: "url-watch-root"
  });
  const thread = workflow.world.createThread({
    id: "knowledge-thread-non-directed",
    parent: root
  });
  seedKnowledgeThread(workflow.store, thread.id);

  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "ignore",
      public_text: null,
      reply_mode: "no_reply"
    })
  });

  const result = await workflow.harnessRunner.routeMessage({
    envelope: {
      guildId: "guild-1",
      channelId: thread.id,
      messageId: "message-non-directed-follow-up",
      authorId: "user-1",
      placeType: "public_thread",
      rawPlaceType: "PublicThread",
      content: "この話も関係しそうです",
      urls: [],
      receivedAt: "2026-05-21T00:00:00.000Z"
    },
    watchLocation: urlWatchLocation(),
    actorRole: "user",
    scope: "server_public",
    chatEngagement: null,
    recentRoomEvents: []
  });

  assert.deepEqual(
    workflow.codex.requests.map((request) => request.task.retry_context?.kind ?? request.task.phase),
    ["intent", "answer"]
  );
  assert.equal(result.response.outcome, "ignore");
  assert.equal(result.response.reply_mode, "no_reply");
  assert.equal(result.response.public_text, null);
});

test("forum thread without knowledge binding remains a plain_thread", async (t) => {
  const workflow = createWorkflow(t);
  const forumRoot = workflow.world.createTextChannel({
    id: "forum-root"
  });
  const thread = workflow.world.createThread({
    id: "forum-plain-thread",
    parent: forumRoot,
    starterContent: "公開情報を整理して"
  });

  workflow.codex.enqueueIntent(
    intent({
      outcome: "chat_reply",
      fetch: "public_research"
    })
  );
  workflow.codex.setForumStreamingTurn({
    text: "forum plain thread reply"
  });

  await workflow.processMessage({
    id: "message-forum-plain-thread",
    channel: thread,
    content: "追加でこの観点も見て",
    urls: [],
    watchLocation: forumLocation(),
    placeType: "forum_post_thread",
    mentionsBot: true
  });

  assert.equal(
    workflow.codex.requests[0]?.available_context.thread_context.kind,
    "plain_thread"
  );
  assert.deepEqual(
    workflow.codex.requests[0]?.available_context.thread_context.known_source_urls,
    []
  );
});

test("AE-E2E-04 output safety blocks unsafe source text before any Discord publish and sends same-place refusal", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: "chat-root"
  });

  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: "未観測の根拠を使った本文です。",
      sources_used: ["https://not-observed.example.com/source"]
    })
  });
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: "まだ未観測の根拠を使った本文です。",
      sources_used: ["https://still-not-observed.example.com/source"]
    })
  });

  await workflow.processMessage({
    id: "message-safety",
    channel: root,
    content: "この話を教えて",
    urls: [],
    watchLocation: chatLocation(),
    mentionsBot: true
  });

  assert.deepEqual(
    workflow.codex.requests.map((request) => request.task.retry_context?.kind ?? request.task.phase),
    ["intent", "answer", "output_safety"]
  );
  assert.equal(
    workflow.sink.sentTexts().some((content) => content.includes("未観測の根拠を使った本文")),
    false,
    "unsafe public_text must not be published before safety retry/refusal"
  );
  assert.deepEqual(
    workflow.eventsOf("reply").map((event) => event.channelId),
    ["chat-root"]
  );
  assert.match(
    workflow.eventsOf("reply")[0]?.content ?? "",
    /出典の公開範囲を安全に満たせなかった/
  );
});

test("knowledge_writes do not persist unobserved URL sources alongside an allowed message URL", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: "url-watch-root"
  });

  workflow.codex.enqueueIntent(
    intent({
      outcome: "knowledge_ingest",
      fetch: "message_urls",
      write: true
    })
  );
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "knowledge_ingest",
      public_text: "観測済みURLだけを共有します。",
      reply_mode: "create_public_thread",
      sources_used: ["https://example.com/allowed"],
      knowledge_writes: [
        {
          source_url: "https://example.com/allowed",
          canonical_url: "https://example.com/allowed",
          title: "Allowed Source",
          summary: "観測済みURLの要約です。",
          tags: ["allowed"],
          content_hash: "allowed-source-hash",
          normalized_text: "観測済みURLの要約です。",
          source_kind: "webpage",
          evidence_fact_ids: [genericFactId("https://example.com/allowed")]
        },
        {
          source_url: "https://not-observed.example.com/poison",
          canonical_url: "https://not-observed.example.com/poison",
          title: "Unobserved Source",
          summary: "このURLは同じturnで観測されていません。",
          tags: ["poison"],
          content_hash: "unobserved-source-hash",
          normalized_text: "このURLは同じturnで観測されていません。",
          source_kind: "webpage",
          evidence_fact_ids: ["fact:web:https://not-observed.example.com/poison:direct"]
        }
      ]
    })
  });
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "knowledge_ingest",
      public_text: "観測済みURLだけを共有します。",
      reply_mode: "create_public_thread",
      sources_used: ["https://example.com/allowed"],
      knowledge_writes: [
        {
          source_url: "https://example.com/allowed",
          canonical_url: "https://example.com/allowed",
          title: "Allowed Source",
          summary: "観測済みURLの要約です。",
          tags: ["allowed"],
          content_hash: "allowed-source-hash",
          normalized_text: "観測済みURLの要約です。",
          source_kind: "webpage",
          evidence_fact_ids: [genericFactId("https://example.com/allowed")]
        }
      ]
    })
  });

  await workflow.processMessage({
    id: "message-knowledge-write-source-safety",
    channel: root,
    content: "https://example.com/allowed",
    urls: ["https://example.com/allowed"],
    watchLocation: urlWatchLocation()
  });

  assert.deepEqual(
    workflow.codex.requests.map((request) => request.task.retry_context?.kind ?? request.task.phase),
    ["intent", "answer", "output_safety"]
  );
  assert.equal(workflow.eventsOf("createThread").length, 1);
  assert.deepEqual(
    workflow.store.knowledgeRecords.findVisibleByCanonicalUrl(
      "https://example.com/allowed",
      ["server_public"],
      ["server_public:guild-1"]
    ).map((candidate) => candidate.canonicalUrl),
    ["https://example.com/allowed"]
  );
  assert.deepEqual(
    workflow.store.knowledgeRecords.findVisibleByCanonicalUrl(
      "https://not-observed.example.com/poison",
      ["server_public"],
      ["server_public:guild-1"]
    ),
    []
  );
});

test("AE-E2E-05 admin diagnostics are explicit and admin-place scoped in observable replies", async (t) => {
  const workflow = createWorkflow(t);
  const adminRoot = workflow.world.createTextChannel({
    id: "admin-root"
  });
  const chatRoot = workflow.world.createTextChannel({
    id: "chat-root"
  });

  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: "通常の管理会話として返します。"
    })
  });
  await workflow.processMessage({
    id: "message-admin-normal",
    channel: adminRoot,
    content: "今の権限はどう見える？",
    urls: [],
    watchLocation: adminLocation(),
    actorRole: "admin",
    mentionsBot: true
  });

  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "admin_diagnostics",
      public_text: null,
      diagnostics: {
        notes: "hostile answer-only diagnostics"
      }
    })
  });
  await workflow.processMessage({
    id: "message-admin-hostile-answer",
    channel: adminRoot,
    content: "普通に返して",
    urls: [],
    watchLocation: adminLocation(),
    actorRole: "admin",
    mentionsBot: true
  });

  workflow.codex.enqueueIntent(intent({ outcome: "admin_diagnostics" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "admin_diagnostics",
      public_text: null,
      diagnostics: {
        notes: "explicit diagnostics requested"
      }
    })
  });
  await workflow.processMessage({
    id: "message-admin-diagnostics",
    channel: adminRoot,
    content: "diagnostics JSON を出して",
    urls: [],
    watchLocation: adminLocation(),
    actorRole: "admin",
    mentionsBot: true
  });

  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: "通常チャンネルでは診断ではなく会話で返します。"
    })
  });
  await workflow.processMessage({
    id: "message-chat-diagnostics",
    channel: chatRoot,
    content: "diagnostics JSON を出して",
    urls: [],
    watchLocation: chatLocation(),
    actorRole: "admin",
    mentionsBot: true
  });

  workflow.codex.enqueueIntent(intent({ outcome: "admin_diagnostics" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "admin_diagnostics",
      public_text: null,
      diagnostics: {
        notes: "hostile chat diagnostics"
      }
    })
  });
  await workflow.processMessage({
    id: "message-chat-hostile-diagnostics",
    channel: chatRoot,
    content: "diagnostics JSON を出して",
    urls: [],
    watchLocation: chatLocation(),
    actorRole: "admin",
    mentionsBot: true
  });

  const replies = workflow.eventsOf("reply").map((event) => event.content);
  assert.equal(replies[0], "通常の管理会話として返します。");
  assert.match(replies[1] ?? "", /explicit diagnostics requested/);
  assert.equal(replies[2], "通常チャンネルでは診断ではなく会話で返します。");
  assert.doesNotMatch(replies[3] ?? "", /hostile chat diagnostics/);
});

test("AE-E2E-05 hostile admin_diagnostics outside admin place does not leak diagnostics", async (t) => {
  const workflow = createWorkflow(t);
  const chatRoot = workflow.world.createTextChannel({
    id: "chat-root"
  });

  workflow.codex.enqueueIntent(intent({ outcome: "admin_diagnostics" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "admin_diagnostics",
      public_text: null,
      diagnostics: {
        notes: "secret diagnostics should not leak"
      }
    })
  });

  await workflow.processMessage({
    id: "message-chat-hostile-diagnostics",
    channel: chatRoot,
    content: "diagnostics JSON を出して",
    urls: [],
    watchLocation: chatLocation(),
    actorRole: "admin"
  });

  assert.equal(
    workflow.sink
      .sentTexts()
      .some(
        (content) =>
          content.includes("secret diagnostics should not leak") ||
          content.includes("admin_diagnostics") ||
          content.includes("codex")
      ),
    false
  );
});

test("AE-E2E-07 forum final safety-before-publish keeps final public text out of Discord during harness resolution", async (t) => {
  const workflow = createWorkflow(t);
  const forumRoot = workflow.world.createTextChannel({
    id: "forum-root"
  });
  const thread = workflow.world.createThread({
    id: "forum-thread",
    parent: forumRoot,
    starterContent: "LLM エージェントの設計を調べて"
  });
  const item = workflow.createQueuedMessage({
    id: "message-forum",
    channel: thread,
    content: "LLM エージェントの設計を調べて",
    urls: ["https://example.com/forum"],
    watchLocation: forumLocation(),
    placeType: "forum_post_thread"
  });

  workflow.codex.enqueueIntent(
    intent({
      outcome: "chat_reply",
      fetch: "public_research"
    })
  );
  workflow.codex.setForumStreamingTurn({
    text: "これは safety 評価前に公開されてはいけない final 本文です。"
  });

  await workflow.service.resolveHarnessMessage(item, undefined, {
    pulseNow: () => Promise.resolve(),
    stop: () => {}
  });

  assert.equal(
    workflow.sink
      .sentTexts()
      .some((content) => content.includes("safety 評価前に公開されてはいけない final 本文")),
    false,
    "forum final text must not be sent by streaming callbacks before safety and dispatch"
  );
});

test("forum_research feature with chat mode still uses forum research flow", async (t) => {
  const workflow = createWorkflow(t);
  const forumRoot = workflow.world.createTextChannel({
    id: "forum-feature-chat-root"
  });
  const thread = workflow.world.createThread({
    id: "forum-feature-chat-thread",
    parent: forumRoot,
    starterContent: "AI エージェントの公開情報を調べて"
  });

  workflow.codex.enqueueIntent(
    intent({
      outcome: "chat_reply",
      fetch: "public_research"
    })
  );
  workflow.codex.setForumStreamingTurn({
    text: "forum feature flow final"
  });

  await workflow.processMessage({
    id: "starter-message",
    channel: thread,
    content: "AI エージェントの公開情報を調べて",
    urls: ["https://example.com/forum-feature"],
    watchLocation: forumFeatureChatLocation(),
    placeType: "forum_post_thread"
  });

  assert.equal(
    workflow.codex.events.some((event) => event.type === "streamingFinal"),
    true
  );
  assert.equal(
    workflow.codex.events.some(
      (event) => event.type === "answer" && event.phase === "answer"
    ),
    false
  );
  assert.deepEqual(
    workflow.eventsOf("reply").map((event) => event.content),
    ["forum feature flow final"]
  );
});

test("clear_explanation root channel messages are ignored without guidance or harness routing", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: CLEAR_EXPLANATION_ROOT_CHANNEL_ID
  });

  await workflow.processMessage({
    id: "message-clear-explanation-root",
    channel: root,
    content: "初心者向けに MCP をわかりやすく解説して",
    urls: [],
    watchLocation: clearExplanationLocation()
  });

  assert.equal(workflow.codex.requests.length, 0);
  assert.equal(workflow.eventsOf("reply").length, 0);
  assert.equal(workflow.eventsOf("send").length, 0);
  assert.equal(workflow.eventsOf("createThread").length, 0);
});

test("clear_explanation thread messages use a thread-lifetime high reasoning explanation session", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: CLEAR_EXPLANATION_ROOT_CHANNEL_ID
  });
  const thread = workflow.world.createThread({
    id: "clear-explanation-thread",
    parent: root,
    starterContent: "RAG と fine tuning の違いを図解つきで教えて"
  });

  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: "用語を分けて、順番に説明します。",
      sources_used: []
    })
  });

  await workflow.processMessage({
    id: "starter-message",
    channel: thread,
    content: "RAG と fine tuning の違いを図解つきで教えて",
    urls: [],
    watchLocation: clearExplanationLocation(),
    placeType: "public_thread"
  });

  const answerEvent = workflow.codex.events.find(
    (event) => event.type === "answer"
  );

  assert.equal(answerEvent?.workloadKind, "clear_explanation");
  assert.equal(
    answerEvent?.modelProfile,
    "clear_explanation:gpt-5.5:high"
  );
  assert.match(answerEvent?.sessionIdentity ?? "", /workload=clear_explanation/);
  assert.match(answerEvent?.sessionIdentity ?? "", /binding_kind=thread/);
  assert.match(answerEvent?.sessionIdentity ?? "", /binding_id=clear-explanation-thread/);
  assert.match(answerEvent?.sessionIdentity ?? "", /lifecycle=thread_lifetime/);
  assert.deepEqual(
    workflow.codex.requests.map((request) => ({
      rootChannelId: request.place.root_channel_id,
      threadId: request.place.thread_id,
      threadKind: request.available_context.thread_context.kind,
      features: request.available_context.place_context.features
    })),
    [
      {
        rootChannelId: CLEAR_EXPLANATION_ROOT_CHANNEL_ID,
        threadId: "clear-explanation-thread",
        threadKind: "plain_thread",
        features: ["clear_explanation", "conversation"]
      },
      {
        rootChannelId: CLEAR_EXPLANATION_ROOT_CHANNEL_ID,
        threadId: "clear-explanation-thread",
        threadKind: "plain_thread",
        features: ["clear_explanation", "conversation"]
      }
    ]
  );
  assert.deepEqual(workflow.eventsOf("reply").map((event) => event.channelId), [
    "clear-explanation-thread"
  ]);
});

test("clear_explanation first-turn gate redirects broad analysis to forum research before starting the explanation session", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: CLEAR_EXPLANATION_ROOT_CHANNEL_ID
  });
  const thread = workflow.world.createThread({
    id: "clear-explanation-redirect-thread",
    parent: root,
    starterContent: "AI活用に縛られず、つくりたいものが見つからない場合にとれるアプローチを検討して"
  });

  workflow.codex.enqueueClearExplanationGateDecision({
    decision: "redirect_to_forum_research",
    reason: "broad strategic analysis"
  });

  await workflow.processMessage({
    id: "starter-message",
    channel: thread,
    content: "AI活用に縛られず、つくりたいものが見つからない場合にとれるアプローチを検討して",
    urls: [],
    watchLocation: clearExplanationLocation(),
    placeType: "public_thread"
  });

  assert.deepEqual(
    workflow.codex.events
      .filter((event) => event.type === "json")
      .map((event) => ({
        kind: event.kind,
        modelProfile: event.modelProfile
      })),
    [
      {
        kind: "clear_explanation_route_gate",
        modelProfile: "clear_explanation_gate:gpt-5.3-codex-spark:low"
      }
    ]
  );
  assert.equal(
    workflow.codex.events.some((event) => event.type === "answer"),
    false
  );
  const expectedRedirectNotice =
    buildClearExplanationQuestionGatewayRedirectNotice(
      [forumLocation()],
      clearExplanationLocation()
    );
  assert.deepEqual(workflow.eventsOf("send").map((event) => event.content), [
    expectedRedirectNotice
  ]);
  assert.equal(
    workflow.store.clearExplanationGateStates.get("clear-explanation-redirect-thread")
      ?.decision,
    "redirect_to_forum_research"
  );

  await workflow.processMessage({
    id: "message-clear-explanation-forum-research-followup",
    channel: thread,
    content: "補足すると、AI以外の観点も含めたいです",
    urls: [],
    watchLocation: clearExplanationLocation(),
    placeType: "public_thread",
    mentionsBot: true
  });

  assert.equal(
    workflow.codex.events.filter((event) => event.type === "json").length,
    1
  );
  assert.deepEqual(workflow.eventsOf("send").map((event) => event.content), [
    expectedRedirectNotice,
    expectedRedirectNotice
  ]);
});

test("clear_explanation first-turn gate declines casual questions without routing them to the chat channel", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: CLEAR_EXPLANATION_ROOT_CHANNEL_ID
  });
  const thread = workflow.world.createThread({
    id: "clear-explanation-decline-thread",
    parent: root,
    starterContent: "おすすめの VRChat ワールドある？"
  });

  workflow.codex.enqueueClearExplanationGateDecision({
    decision: "decline_clear_explanation",
    reason: "casual recommendation"
  });

  await workflow.processMessage({
    id: "starter-message",
    channel: thread,
    content: "おすすめの VRChat ワールドある？",
    urls: [],
    watchLocation: clearExplanationLocation(),
    placeType: "public_thread"
  });

  assert.equal(
    workflow.codex.events.some((event) => event.type === "answer"),
    false
  );
  assert.deepEqual(workflow.eventsOf("send").map((event) => event.content), [
    CLEAR_EXPLANATION_DECLINE_NOTICE
  ]);
  assert.equal(
    workflow.eventsOf("send").some((event) =>
      event.content.includes("1365210184657670207")
    ),
    false
  );
  assert.equal(
    workflow.store.clearExplanationGateStates.get("clear-explanation-decline-thread")
      ?.decision,
    "decline_clear_explanation"
  );
});

test("clear_explanation gate runs only once per thread and fails open", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: CLEAR_EXPLANATION_ROOT_CHANNEL_ID
  });
  const thread = workflow.world.createThread({
    id: "clear-explanation-gate-once-thread",
    parent: root,
    starterContent: "Attention の仕組みを初心者向けに教えて"
  });

  workflow.codex.enqueueClearExplanationGateError();
  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: "まず前提から説明します。",
      sources_used: []
    })
  });

  await workflow.processMessage({
    id: "starter-message",
    channel: thread,
    content: "Attention の仕組みを初心者向けに教えて",
    urls: [],
    watchLocation: clearExplanationLocation(),
    placeType: "public_thread"
  });

  workflow.codex.enqueueClearExplanationGateDecision({
    decision: "decline_clear_explanation",
    reason: "would decline if gate reran"
  });
  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: "続きとして、別の角度から説明します。",
      sources_used: []
    })
  });

  await workflow.processMessage({
    id: "message-clear-explanation-gate-followup",
    channel: thread,
    content: "もう少し噛み砕いて",
    urls: [],
    watchLocation: clearExplanationLocation(),
    placeType: "public_thread",
    mentionsBot: true
  });

  assert.equal(
    workflow.codex.events.filter((event) => event.type === "json").length,
    1
  );
  assert.deepEqual(workflow.eventsOf("reply").map((event) => event.content), [
    "まず前提から説明します。",
    "続きとして、別の角度から説明します。"
  ]);
  assert.equal(
    workflow.store.clearExplanationGateStates.get("clear-explanation-gate-once-thread")
      ?.reason,
    "gate_failed_open"
  );
});

test("clear_explanation sends long plain text in Discord-safe chunks and attaches generated images from app-server results", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: CLEAR_EXPLANATION_ROOT_CHANNEL_ID
  });
  const thread = workflow.world.createThread({
    id: "clear-explanation-image-thread",
    parent: root,
    starterContent: "仕組みを画像つきで順番に説明して"
  });
  const longText = buildLongExplanationText();

  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: longText,
      sources_used: []
    }),
    observations: imageGenerationObservations([
      {
        origin: "imageGeneration",
        id: "structured-image",
        filename: "clear-explanation-structured.png",
        base64: STRUCTURED_IMAGE_BASE64
      },
      {
        origin: "image_generation_call",
        id: "raw-image",
        filename: "clear-explanation-raw.png",
        base64: RAW_IMAGE_BASE64
      }
    ])
  });

  await workflow.processMessage({
    id: "starter-message",
    channel: thread,
    content: "仕組みを画像つきで順番に説明して",
    urls: [],
    watchLocation: clearExplanationLocation(),
    placeType: "public_thread"
  });

  const visibleTextEvents: Array<{ content: string }> = [
    ...workflow.eventsOf("reply"),
    ...workflow.eventsOf("send")
  ];
  assert.ok(visibleTextEvents.length >= 2, "long replies must be split");
  assert.equal(
    visibleTextEvents.every((event) => event.content.length <= 1900),
    true
  );
  assert.deepEqual(sentFileNames(workflow.sink.sentFiles()), [
    "clear-explanation-structured.png",
    "clear-explanation-raw.png"
  ]);
});

test("clear_explanation output safety retry publishes only retry-turn generated images", async (t) => {
  const workflow = createWorkflow(t);
  const root = workflow.world.createTextChannel({
    id: CLEAR_EXPLANATION_ROOT_CHANNEL_ID
  });
  const thread = workflow.world.createThread({
    id: "clear-explanation-safety-thread",
    parent: root,
    starterContent: "画像つきで噛み砕いて説明して"
  });

  workflow.codex.enqueueIntent(intent({ outcome: "chat_reply" }));
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: "未観測ソースつきの初回説明です。",
      sources_used: ["https://not-observed.example.com/unsafe"]
    }),
    observations: imageGenerationObservations([
      {
        origin: "imageGeneration",
        id: "unsafe-first-image",
        filename: "unsafe-first-turn.png",
        base64: FIRST_TURN_IMAGE_BASE64
      }
    ])
  });
  workflow.codex.enqueueAnswer({
    response: response({
      outcome: "chat_reply",
      public_text: "公開可能な範囲で説明し直します。",
      sources_used: []
    }),
    observations: imageGenerationObservations([
      {
        origin: "imageGeneration",
        id: "safe-retry-image",
        filename: "safe-retry-turn.png",
        base64: RETRY_TURN_IMAGE_BASE64
      }
    ])
  });

  await workflow.processMessage({
    id: "starter-message",
    channel: thread,
    content: "画像つきで噛み砕いて説明して",
    urls: [],
    watchLocation: clearExplanationLocation(),
    placeType: "public_thread"
  });

  assert.deepEqual(
    workflow.codex.requests.map((request) => request.task.retry_context?.kind ?? request.task.phase),
    ["intent", "answer", "output_safety"]
  );
  assert.deepEqual(sentFileNames(workflow.sink.sentFiles()), [
    "safe-retry-turn.png"
  ]);
  assert.equal(
    workflow.sink.sentTexts().some((content) => content.includes("未観測ソース")),
    false,
    "unsafe first-turn text must not be published"
  );
});

// TODO(AE-E2E-06): override start/use/close needs the slash-command bootstrap
// service plus override session storage in the same workflow fixture. Keep it as
// a real E2E, not a helper call-count test: the oracle should be dedicated
// thread creation, same-actor workspace-write routing, and archive order.

function createWorkflow(t: test.TestContext) {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-e2e-"));
  const store = new SqliteStore(join(tempDir, "bot.sqlite"), process.cwd());
  store.migrate();
  t.after(() => {
    store.close();
    rmSync(tempDir, {
      recursive: true,
      force: true
    });
  });

  const world = new FakeDiscordWorld();
  const codex = new ScriptedCodexClient();
  const codexClient = asCodexClient(codex);
  const sessionPolicyResolver = new SessionPolicyResolver();
  const sessionManager = new SessionManager(store, codexClient, logger);
  const promptRefiner = new ForumResearchPromptRefiner(codexClient, logger);
  const supervisor = new ForumResearchSupervisor(codexClient, logger);
  const harnessRunner = new HarnessRunner(
    store,
    codexClient,
    sessionPolicyResolver,
    sessionManager,
    promptRefiner,
    supervisor,
    logger,
    async (url) => ({
      requestedUrl: url,
      finalUrl: url,
      canonicalUrl: url,
      public: true,
      status: 200,
      contentType: "text/plain",
      title: "Fetched E2E Source",
      text: `Fetched public text for ${url}.`
    })
  );
  const watchLocations = [
    urlWatchLocation(),
    chatLocation(),
    adminLocation(),
    forumLocation(),
    clearExplanationLocation()
  ];
  const replyDispatchService = new ReplyDispatchService({
    store,
    harnessRunner,
    sessionManager,
    sessionPolicyResolver,
    watchLocations,
    logger,
    fetchChannel: async (channelId) => world.getChannel(channelId) as never
  });
  const clearExplanationRoutingGate = new ClearExplanationRoutingGate(
    store,
    codexClient,
    logger
  );
  const service = new MessageProcessingService(
    appConfig(watchLocations),
    store,
    harnessRunner,
    new ForumFirstTurnPreprocessor(store, sessionPolicyResolver, logger),
    new RecentChatHistoryService(logger),
    new ChatEngagementPolicy(),
    new FeatureThreadService(),
    clearExplanationRoutingGate,
    new FailureClassifier(),
    {
      clear: () => {},
      schedule: () => {}
    } as unknown as RetrySchedulerService,
    NOOP_BOT_MODERATION_INTEGRATION,
    noopModerationExecutor(),
    replyDispatchService,
    logger
  );

  const createQueuedMessage = (input: ProcessMessageInput): QueuedMessage => {
    const message = createFakeMessage({
      id: input.id,
      channel: input.channel,
      world,
      content: input.content,
      urls: input.urls,
      ...(input.authorId === undefined ? {} : { authorId: input.authorId }),
      ...(input.mentionsBot === undefined ? {} : { mentionsBot: input.mentionsBot }),
      ...(input.replyToBot === undefined ? {} : { replyToBot: input.replyToBot })
    });
    const envelope: MessageEnvelope = {
      guildId: "guild-1",
      channelId: input.channel.id,
      messageId: input.id,
      authorId: input.authorId ?? "user-1",
      placeType:
        input.placeType ??
        (input.channel.isThread() ? "public_thread" : "guild_text"),
      rawPlaceType: input.channel.isThread() ? "PublicThread" : "GuildText",
      content: input.content,
      urls: input.urls,
      receivedAt: "2026-05-21T00:00:00.000Z"
    };
    return {
      messageId: input.id,
      orderingKey: input.id,
      source: "live",
      message,
      envelope,
      watchLocation: input.watchLocation,
      actorRole: input.actorRole ?? "user",
      scope: input.watchLocation.defaultScope,
      chatEngagement: null
    };
  };

  return {
    store,
    world,
    sink: world.sink,
    harnessRunner,
    codex,
    service,
    createQueuedMessage,
    processMessage: (input: ProcessMessageInput) =>
      service.process(createQueuedMessage(input)),
    eventsOf: <T extends FakeDiscordEvent["type"]>(type: T) =>
      world.sink.events.filter(
        (event): event is Extract<FakeDiscordEvent, { type: T }> =>
          event.type === type
      ),
    indexOf: (event: FakeDiscordEvent | undefined) =>
      event === undefined ? -1 : world.sink.events.indexOf(event)
  };
}

function genericFactId(url: string): string {
  return `fact:web:${url}:direct`;
}

type ProcessMessageInput = {
  id: string;
  channel: FakeDiscordChannel;
  content: string;
  urls: string[];
  watchLocation: WatchLocationConfig;
  placeType?: MessageEnvelope["placeType"];
  actorRole?: QueuedMessage["actorRole"];
  authorId?: string;
  mentionsBot?: boolean;
  replyToBot?: boolean;
};

function appConfig(watchLocations: WatchLocationConfig[]): AppConfig {
  return {
    discordBotToken: "test",
    discordApplicationId: "app",
    discordOwnerUserIds: ["owner-1"],
    botDbPath: ":memory:",
    botLogLevel: "fatal",
    runtime: {
      maxConcurrentKeys: 4,
      retryPollIntervalMs: 15_000,
      codexIdleCloseMs: 1_800_000,
      ambientSparseInterval: 5
    },
    codexAppServerCommand: "test",
    codexHomePath: null,
    watchLocations,
    chatRuntimeControls: null,
    weeklyMeetupAnnouncement: null
  };
}

function urlWatchLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "url-watch-root",
    mode: "url_watch",
    defaultScope: "server_public",
    features: ["knowledge_ingest", "conversation"],
    chatBehavior: null
  };
}

function chatLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "chat-root",
    mode: "chat",
    defaultScope: "server_public",
    features: ["conversation"],
    chatBehavior: "directed_help_chat"
  };
}

function knowledgeFeatureChatLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "knowledge-chat-root",
    mode: "chat",
    defaultScope: "server_public",
    features: ["knowledge_ingest", "conversation"],
    chatBehavior: null
  };
}

function adminLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "admin-root",
    mode: "admin_control",
    defaultScope: "conversation_only",
    features: ["admin_override", "conversation"],
    chatBehavior: "directed_help_chat"
  };
}

function forumLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "forum-root",
    mode: "forum_longform",
    defaultScope: "server_public",
    features: ["forum_research", "conversation"],
    chatBehavior: null
  };
}

function forumFeatureChatLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "forum-feature-chat-root",
    mode: "chat",
    defaultScope: "server_public",
    features: ["forum_research", "conversation"],
    chatBehavior: null
  };
}

function clearExplanationLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: CLEAR_EXPLANATION_ROOT_CHANNEL_ID,
    mode: "chat",
    defaultScope: "server_public",
    features: ["clear_explanation", "conversation"] as unknown as NonNullable<
      WatchLocationConfig["features"]
    >,
    chatBehavior: null
  };
}

function buildLongExplanationText(): string {
  return [
    "まず全体像です。",
    "入力、処理、出力の三つに分けると、どこで何が起きているかを追いやすくなります。".repeat(20),
    "次に具体例です。",
    "利用者の質問を小さな単位に分け、必要な情報を集め、最後に読みやすい順番へ並べ直します。".repeat(20),
    "最後に注意点です。",
    "図は理解を助ける補助なので、本文と矛盾しない範囲で扱います。".repeat(20)
  ].join("\n\n");
}

function imageGenerationObservations(
  images: Array<{
    origin: "imageGeneration" | "image_generation_call";
    id: string;
    filename: string;
    base64: string;
  }>
): TurnObservations {
  return {
    observed_public_urls: [],
    generated_images: images.map((image) => ({
      origin: image.origin,
      id: image.id,
      status: "completed",
      mime_type: "image/png",
      filename: image.filename,
      data_base64: image.base64
    }))
  } as unknown as TurnObservations;
}

function sentFileNames(files: FakeDiscordAttachment[]): string[] {
  return files.map((file) => file.name).filter((name): name is string => name !== null);
}

function seedKnowledgeThread(store: SqliteStore, threadId: string): void {
  store.knowledgeRecords.insert({
    recordId: "record-knowledge-thread",
    canonicalUrl: "https://example.com/original",
    domain: "example.com",
    title: "Original",
    summary: "Original summary",
    tags: ["original"],
    scope: "server_public",
    visibilityKey: "server_public:guild-1",
    contentHash: "hash-original",
    createdAt: "2026-05-21T00:00:00.000Z"
  });
  store.sourceLinks.insert({
    linkId: "link-knowledge-thread",
    recordId: "record-knowledge-thread",
    sourceMessageId: "message-original",
    replyThreadId: threadId,
    createdAt: "2026-05-21T00:00:00.000Z"
  });
}

function noopModerationExecutor(): ModerationExecutor {
  return {
    async timeoutMember() {
      return {
        ok: true,
        action: "timeout",
        deliveryStatus: "applied"
      };
    },
    async kickMember() {
      return {
        ok: true,
        action: "kick",
        deliveryStatus: "applied"
      };
    }
  };
}
