import test from "node:test";
import assert from "node:assert/strict";

import { resolveHarnessCapabilities } from "../../src/harness/capability-resolver.js";
import type { HarnessIntentResponse, HarnessRequest } from "../../src/harness/contracts.js";

test("knowledge thread follow-ups never grant knowledge writes", () => {
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
      channel_id: "thread-1",
      root_channel_id: "root-1",
      thread_id: "thread-1",
      mode: "url_watch",
      place_type: "public_thread",
      scope: "server_public"
    },
    message: {
      id: "message-1",
      content: "これも保存して https://example.com/update",
      urls: ["https://example.com/update"],
      created_at: "2026-04-13T00:00:00.000Z"
    },
    capabilities: {
      allow_external_fetch: false,
      allow_knowledge_write: false,
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
        kind: "knowledge_thread",
        source_message_id: "message-0",
        known_source_urls: ["https://example.com/original"],
        reply_thread_id: "thread-1",
        root_channel_id: "root-1"
      },
      place_context: {
        is_knowledge_place: true
      },
      delivery_context: {
        is_bot_directed: false,
        bot_directed_trigger_kind: null
      },
      discord_runtime_facts_path: null,
      fetchable_public_urls: ["https://example.com/update"],
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

  const intent = {
    outcome_candidate: "knowledge_ingest",
    repo_write_intent: false,
    requested_external_fetch: "known_thread_sources",
    requested_knowledge_write: true,
    moderation_signal: {
      violation_category: "none",
      control_request_class: null,
      notes: null
    },
    diagnostics: {
      notes: null
    }
  } satisfies HarnessIntentResponse;

  const resolved = resolveHarnessCapabilities({
    actorRole: "user",
    request,
    intent,
    workspaceWriteActive: false
  });

  assert.equal(resolved.allow_external_fetch, true);
  assert.equal(resolved.allow_knowledge_write, false);
});
