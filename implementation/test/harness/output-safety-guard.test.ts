import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteStore } from "../../src/storage/sqlite-store.js";
import { OutputSafetyGuard } from "../../src/harness/output-safety-guard.js";
import type { HarnessRequest, HarnessResponse } from "../../src/harness/contracts.js";

test("output safety keeps fetchable public urls available for retry grounding", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-output-safety-"));
  const store = new SqliteStore(join(tempDir, "bot.sqlite"), process.cwd());
  store.migrate();

  try {
    const guard = new OutputSafetyGuard(store);
    const request = {
      request_id: "req-1",
      source: {
        adapter: "discord",
        event: "message_create"
      },
      actor: {
        user_id: "user-1",
        role: "user"
      },
      place: {
        guild_id: "guild-1",
        channel_id: "channel-1",
        root_channel_id: "channel-1",
        thread_id: null,
        mode: "url_watch",
        place_type: "guild_text",
        scope: "server_public"
      },
      message: {
        id: "message-1",
        content: "shared link",
        urls: ["https://x.com/openaidevs/status/2033636701848174967"],
        created_at: "2026-03-17T05:22:27.887Z"
      },
      capabilities: {
        allow_external_fetch: true,
        allow_knowledge_write: true,
        allow_moderation: false
      },
      override_context: {
        active: false,
        same_actor: false,
        started_by: null,
        started_at: null,
        flags: {
          allow_playwright_headed: false,
          allow_playwright_persistent: false,
          allow_prompt_injection_test: false,
          suspend_violation_counter_for_current_thread: false,
          allow_external_fetch_in_private_context_without_private_terms: false
        }
      },
      available_context: {
        thread_context: {
          kind: "root_channel",
          source_message_id: null,
          known_source_urls: [],
          reply_thread_id: null,
          root_channel_id: "channel-1"
        },
        place_context: {
          is_knowledge_place: true
        },
        delivery_context: {
          is_bot_directed: false,
          bot_directed_trigger_kind: null
        },
        discord_runtime_facts_path: null,
        fetchable_public_urls: ["https://x.com/openaidevs/status/2033636701848174967"],
        blocked_urls: [],
        chat_behavior: null,
        chat_engagement: null,
        recent_room_events: []
      },
      task: {
        kind: "route_message",
        phase: "answer",
        retry_context: null
      }
    } satisfies HarnessRequest;
    const response = {
      outcome: "knowledge_ingest",
      repo_write_intent: false,
      public_text: "Codex の一般提供を共有します。",
      reply_mode: "create_public_thread",
      target_thread_id: null,
      selected_source_ids: [],
      sources_used: ["https://openai.com/index/codex-now-generally-available/"],
      knowledge_writes: [],
      diagnostics: {
        notes: null
      },
      sensitivity_raise: "none"
    } satisfies HarnessResponse;

    const evaluation = guard.evaluate({
      request,
      response,
      linkedKnowledgeSources: [],
      observedPublicUrls: []
    });

    assert.equal(evaluation.decision, "retry");
    assert.match(evaluation.reason ?? "", /source url is not visible in current scope/);
    assert.deepEqual(evaluation.allowedSources, [
      "https://x.com/openaidevs/status/2033636701848174967"
    ]);
    assert.deepEqual(evaluation.disallowedSources, [
      "https://openai.com/index/codex-now-generally-available/"
    ]);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
