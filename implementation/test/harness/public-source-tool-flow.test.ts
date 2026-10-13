import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pino from "pino";
import { CodexAppServerClient } from "../../src/codex/app-server-client.js";
import { SessionManager } from "../../src/codex/session-manager.js";
import { SessionPolicyResolver } from "../../src/codex/session-policy.js";
import { HarnessRunner, type HarnessMessageContext } from "../../src/harness/harness-runner.js";
import { buildHarnessRequest } from "../../src/harness/build-harness-request.js";
import { ForumResearchPromptRefiner } from "../../src/runtime/forum/forum-research-prompt-refiner.js";
import { ForumResearchSupervisor } from "../../src/runtime/forum/forum-research-supervisor.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";

test("host tool pages reach safety, existing retry and persistence; other turns cannot reuse them", { timeout: 30_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "public-source-flow-"));
  const store = new SqliteStore(join(directory, "test.sqlite"), process.cwd());
  store.migrate();
  const logger = pino({ enabled: false });
  const body = "The source explains agent memory and collaboration.\n".repeat(350) + "FINAL CONDITION: safety remains necessary.";
  let fetches = 0;
  const fetcher = async (url: string) => {
    fetches++;
    return { requestedUrl: url, finalUrl: url, canonicalUrl: url, public: true as const, status: 200, contentType: url.includes("/pdf/") ? "application/pdf" : "text/plain", title: "Foundation Agents", text: url.includes("/pdf/") ? null : body };
  };
  const client = new CodexAppServerClient(`node "${resolve("implementation/test/support/public-source-tool-app-server.mjs")}"`, process.cwd(), null, logger, { publicSourceFetcher: fetcher });
  t.after(async () => { await client.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const policy = new SessionPolicyResolver();
  const manager = new SessionManager(store, client, logger);
  const runner = new HarnessRunner(store, client, policy, manager, new ForumResearchPromptRefiner(client, logger), new ForumResearchSupervisor(client, logger), logger, fetcher);
  const context: HarnessMessageContext = {
    actorRole: "user", scope: "server_public",
    watchLocation: { guildId: "guild", channelId: "root", mode: "url_watch", defaultScope: "server_public", features: ["knowledge_ingest", "conversation"] },
    envelope: { guildId: "guild", channelId: "root", messageId: "plain", authorId: "user", placeType: "guild_text", rawPlaceType: "GuildText", content: "plain", urls: ["https://arxiv.org/pdf/2504.01990"], receivedAt: "2026-09-09T00:00:00Z" }
  };
  for (const mode of ["plain", "retry"]) {
    context.envelope = { ...context.envelope, messageId: mode, content: mode };
    const routed = await runner.routeMessage(context);
    assert.equal(routed.response.public_text, body);
    assert.equal(routed.response.outcome, "knowledge_ingest");
    runner.persistKnowledgeResult({ ...context, response: routed.response, replyThreadId: "reply-thread", persistenceScope: "server_public" });
    const links = store.sourceLinks.listForSourceMessage(mode);
    assert.equal(links.length, 1);
    assert.equal(store.knowledgeRecords.get(links[0]!.record_id)?.summary, body);
  }
  const beforeDenied = fetches;
  const thread = await client.startThread("read-only");
  for (const [mode, allowed] of [["no-access", false], ["foreign-thread", true], ["stale-cursor", true]] as const) {
    const request = buildHarnessRequest({ ...context, envelope: { ...context.envelope, content: mode }, taskKind: "knowledge_ingest", allowExternalFetch: allowed });
    const result = await client.runHarnessRequest(thread, request);
    assert.equal(result.response.outcome, "failure");
    assert.deepEqual(result.observations.public_source_facts, []);
  }
  assert.equal(fetches, beforeDenied, "denied calls cannot perform network acquisition");
});
