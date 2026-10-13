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

test("forum host evidence and live reports survive concurrent outcomes; history cannot mint current facts", { timeout: 30_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "forum-flow-"));
  const store = new SqliteStore(join(directory, "test.sqlite"), process.cwd());
  store.migrate();
  const logger = pino({ enabled: false });
  const body = "Original source material.\n".repeat(50_000) + "END CONDITION: limited to evaluated settings.";
  const client = new CodexAppServerClient(`node "${resolve("implementation/test/support/forum-research-app-server.mjs")}"`, process.cwd(), null, logger, {
    publicSourceFetcher: async url => ({ requestedUrl: url, finalUrl: url, canonicalUrl: url, public: true as const, status: url.endsWith("unavailable") ? 503 : 200, contentType: "text/plain", title: "Source", text: url.endsWith("unavailable") ? null : url.endsWith("/lead") ? "Lead finding retained across research decisions" : body })
  });
  t.after(async () => { await client.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const payloads: Array<Record<string, any>> = [];
  const runJson = client.runJsonTurn.bind(client);
  client.runJsonTurn = async input => { payloads.push(structuredClone(input.inputPayload) as Record<string, any>); return runJson(input); };
  const runText = client.runStreamingTextTurn.bind(client);
  client.runStreamingTextTurn = async input => { payloads.push(structuredClone(input.inputPayload) as Record<string, any>); return runText(input); };
  const pipeline = new ForumResearchPipeline(store, client, new ForumResearchPromptRefiner(client, logger), new ForumResearchSupervisor(client, logger), logger);
  const request = buildHarnessRequest({
    actorRole: "user", scope: "server_public", taskKind: "route_message", allowExternalFetch: true,
    watchLocation: { guildId: "guild", channelId: "root", mode: "forum_longform", features: ["forum_research", "conversation"], defaultScope: "server_public" },
    envelope: { guildId: "guild", channelId: "thread", messageId: "first", authorId: "user", placeType: "forum_post_thread", rawPlaceType: "PublicThread", content: "元の質問と具体的用途", urls: [], receivedAt: "2026-09-09T00:00:00Z" },
    threadContext: { kind: "plain_thread", rootChannelId: "root", replyThreadId: "thread", knownSourceUrls: [], sourceMessageId: null }
  });
  const published: string[] = [];
  const run = (session: string) => pipeline.runParallel({ request, threadId: "final-thread", sessionMetadata: { sessionIdentity: session, modelProfile: "test", workloadKind: "forum_longform", runtimeContractVersion: "test" }, callbacks: { onProgressNotice: notice => { published.push(notice); }, recentProgressNotices: () => [...published] } });
  const first = await run("previous-profile-session");
  assert.equal(first.response.outcome, "chat_reply");
  assert.deepEqual(first.response.sources_used, ["https://example.com/research"]);
  assert.equal(first.observations.public_source_facts!.map(f => f.text).join(""), body);
  assert.ok(first.observations.public_source_facts!.length > 1);
  assert.ok(first.observations.public_source_failures!.some(f => f.retrieval_url === "https://example.com/unavailable"));
  assert.equal(published.length, 1);
  const inFlight = payloads.find(p => p.kind === "forum_research_supervisor" && p.worker_progress.length > 0 && p.active_workers.filter((w: any) => w.state === "running").length === 4);
  assert.ok(inFlight, "supervision receives reports before the workers finish");
  assert.equal(first.state.evidence.resolve(inFlight.current_source_catalog.flatMap((s: any) => s.evidence_fact_ids)).map(f => f.text).join(""), body);
  assert.ok(inFlight.original_request.available_context.public_source_failures.length > 0);
  const lastSupervisor = payloads.filter(p => p.kind === "forum_research_supervisor").at(-1)!;
  assert.deepEqual(lastSupervisor.active_workers.map((w: any) => [w.worker_id, w.state]).sort(), [["fail", "failed"], ["slow", "interrupted"], ["unknown", "failed"]]);
  assert.deepEqual(lastSupervisor.recent_progress_notices, published);
  const final = payloads.find(p => p.kind === "forum_research_streaming_final")!;
  assert.equal(final.request.message.content, "元の質問と具体的用途");
  assert.equal(first.state.evidence.resolve(final.forum_research_context.source_catalog.flatMap((s: any) => s.evidence_fact_ids)).map(f => f.text).join(""), body);
  assert.ok(final.request.available_context.public_source_failures.length > 0);
  assert.equal(final.forum_research_context.current_worker_packets.length, 1);
  assert.deepEqual(final.forum_research_context.current_worker_packets[0].limitations, ["limitations"]);
  assert.deepEqual(final.forum_research_context.current_worker_packets[0].evidence_items[0].source_urls, ["https://example.com/research"]);

  // A model-profile change must preserve thread history without treating its IDs
  // as freshly acquired evidence for the new question.
  request.message.id = "foreign";
  request.message.content = "訂正後の最新質問";
  const second = await run("new-profile-session");
  assert.deepEqual(second.response.sources_used, []);
  assert.deepEqual(second.state.bundle.currentWorkerPackets, []);
  assert.deepEqual(second.state.evidence.facts, []);
  assert.equal(second.state.persistedState?.sourceCatalog[0]?.url, "https://example.com/research");
  assert.deepEqual(second.state.persistedState?.sourceCatalog[0]?.evidence_fact_ids, []);
  assert.equal(payloads.at(-1)!.request.message.content, "訂正後の最新質問");

  request.message.id = "start-failure";
  const partialLaunch = await run("launch-failure-session");
  assert.equal(partialLaunch.state.bundle.currentWorkerPackets.length, 1, "one launch failure must still let the supervisor use surviving workers");

  request.message.id = "lead";
  const lead = await run("lead-session");
  assert.equal(lead.state.finalBrief, "Lead finding retained across research decisions");
  assert.ok(lead.observations.public_source_facts!.some(f => f.canonical_item_url === "https://example.com/lead"));
  assert.ok(lead.response.sources_used.includes("https://example.com/lead"), "the final consumer can cite the lead's own research");

  request.capabilities.allow_external_fetch = false;
  const deniedLead = await run("denied-lead-session");
  assert.deepEqual(deniedLead.state.evidence.facts, [], "a new lead session cannot reuse old authority or acquired facts");
  assert.deepEqual(deniedLead.response.sources_used, []);
  request.capabilities.allow_external_fetch = true;

  request.message.id = "abort";
  const controller = new AbortController();
  const beforeFinals = payloads.filter(p => p.kind === "forum_research_streaming_final").length;
  await assert.rejects(pipeline.runParallel({ request, threadId: "final-thread", sessionMetadata: { sessionIdentity: "abort-session", modelProfile: "test", workloadKind: "forum_longform", runtimeContractVersion: "test" }, callbacks: { signal: controller.signal, onProgressNotice: () => { controller.abort(new Error("Workflow switched")); } } }), /Workflow switched/);
  assert.equal(payloads.filter(p => p.kind === "forum_research_streaming_final").length, beforeFinals, "abandoned runs cannot synthesize late worker results");
});
