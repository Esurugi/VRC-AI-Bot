import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pino from "pino";
import { CodexAppServerClient } from "../../src/codex/app-server-client.js";
import { ForumResearchPipeline } from "../../src/harness/forum-research-pipeline.js";
import { buildHarnessRequest } from "../../src/harness/build-harness-request.js";
import { ForumResearchPromptRefiner } from "../../src/runtime/forum/forum-research-prompt-refiner.js";
import { ForumResearchSupervisor } from "../../src/runtime/forum/forum-research-supervisor.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
import { SessionManager } from "../../src/codex/session-manager.js";
import { SessionPolicyResolver } from "../../src/codex/session-policy.js";

test("normal forum research uses one Astra turn with live evidence, progress, history and cancellation", { timeout: 30_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "forum-single-"));
  const store = new SqliteStore(join(directory, "test.sqlite"), process.cwd());
  store.migrate();
  const logger = pino({ enabled: false });
  const body = "Original source material.\n".repeat(50_000) + "END CONDITION: limited to evaluated settings.";
  const client = new CodexAppServerClient(`node "${resolve("implementation/test/support/forum-research-app-server.mjs")}"`, process.cwd(), null, logger, {
    publicSourceFetcher: async url => ({ requestedUrl: url, finalUrl: url, canonicalUrl: url, public: true as const, status: url.endsWith("unavailable") ? 503 : 200, contentType: "text/plain", title: "Source", text: url.endsWith("unavailable") ? null : body })
  });
  t.after(async () => { await client.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const payloads: Array<Record<string, any>> = [];
  const turns: Array<{ threadId: string; modelProfile: string | undefined }> = [];
  const runText = client.runStreamingTextTurn.bind(client);
  client.runStreamingTextTurn = async input => {
    payloads.push(structuredClone(input.inputPayload) as Record<string, any>);
    turns.push({ threadId: input.threadId, modelProfile: input.modelProfile });
    return runText(input);
  };
  client.runJsonTurn = async () => { throw new Error("normal forum must not invoke refiner, supervisor or workers"); };
  client.startEphemeralThread = async () => { throw new Error("normal forum must not create research agents"); };
  const pipeline = new ForumResearchPipeline(store, client, new ForumResearchPromptRefiner(client, logger), new ForumResearchSupervisor(client, logger), logger);
  const request = buildHarnessRequest({
    actorRole: "user", scope: "server_public", taskKind: "route_message", allowExternalFetch: true,
    watchLocation: { guildId: "guild", channelId: "root", mode: "forum_longform", features: ["forum_research", "conversation"], defaultScope: "server_public" },
    envelope: { guildId: "guild", channelId: "thread", messageId: "first", authorId: "user", placeType: "forum_post_thread", rawPlaceType: "PublicThread", content: "元の質問と具体的用途", urls: [], receivedAt: "2026-09-13T00:00:00Z" },
    threadContext: { kind: "plain_thread", rootChannelId: "root", replyThreadId: "thread", knownSourceUrls: [], sourceMessageId: null }
  });
  const published: string[] = [];
  const starts = client.startThread.bind(client);
  client.startThread = async (...args) => {
    assert.equal(args[1]?.model, "gpt-6-astra");
    assert.equal(args[1]?.reasoningEffort, "low");
    assert.equal(args[2]?.forumResearchSingle, true);
    return starts(...args);
  };
  const identity = new SessionPolicyResolver().resolveForMessage({
    watchLocation: { guildId: "guild", channelId: "root", mode: "forum_longform", features: ["forum_research", "conversation"], defaultScope: "server_public" },
    envelope: { guildId: "guild", channelId: "thread", messageId: "first", authorId: "user", placeType: "forum_post_thread", rawPlaceType: "PublicThread", content: request.message.content, urls: [], receivedAt: "2026-09-13T00:00:00Z" },
    actorRole: "user", scope: "server_public", workspaceWriteActive: false
  });
  const { threadId } = await new SessionManager(store, client, logger).getOrStartSession(identity);
  const metadata = { sessionIdentity: "single-session", modelProfile: "forum-supervisor:gpt-6-astra:low", workloadKind: "forum_longform", runtimeContractVersion: "single-test" };
  const run = () => pipeline.run({ request, threadId, sessionMetadata: metadata, starterMessage: "最初の相談", callbacks: { onProgressNotice: notice => { published.push(notice); } } });
  const first = await run();
  assert.deepEqual(turns, [{ threadId, modelProfile: "forum-supervisor:gpt-6-astra:low" }]);
  assert.equal(payloads[0]!.request.message.content, "元の質問と具体的用途");
  assert.equal(payloads[0]!.forum_research_context.starter_message, "最初の相談");
  assert.equal(first.observations.public_source_facts!.map(f => f.text).join(""), body);
  assert.ok(first.observations.public_source_failures!.length);
  assert.deepEqual(first.response.sources_used, ["https://example.com/research"]);
  assert.ok(first.response.public_text!.length > 2000);
  assert.equal(published.length, 1);
  assert.equal(first.state.bundle.currentWorkerPackets.length, 0);
  assert.ok(store.forumResearchStates.get(metadata.sessionIdentity));

  request.message.id = "foreign";
  request.message.content = "訂正後の最新質問";
  metadata.sessionIdentity = "replacement-session";
  const followup = await run();
  assert.equal(payloads.at(-1)!.request.message.content, "訂正後の最新質問");
  assert.equal(followup.state.persistedState?.sourceCatalog[0]?.url, "https://example.com/research");
  assert.deepEqual(followup.state.persistedState?.sourceCatalog[0]?.evidence_fact_ids, []);
  assert.deepEqual(followup.observations.public_source_facts, []);

  request.message.id = "denied";
  request.capabilities.allow_external_fetch = false;
  const denied = await run();
  assert.deepEqual(denied.response.sources_used, []);
  assert.deepEqual(denied.observations.public_source_facts, []);
  request.capabilities.allow_external_fetch = true;
  request.message.id = "abort";
  const controller = new AbortController();
  await assert.rejects(pipeline.run({ request, threadId, sessionMetadata: metadata, callbacks: { signal: controller.signal, onProgressNotice: () => { controller.abort(new Error("Workflow switched")); } } }), /Workflow switched/);
});
