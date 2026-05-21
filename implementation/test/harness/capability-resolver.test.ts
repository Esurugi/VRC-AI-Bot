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
        features: ["knowledge_ingest", "conversation"],
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

  const missingBindingResolved = resolveHarnessCapabilities({
    actorRole: "user",
    request: {
      ...request,
      available_context: {
        ...request.available_context,
        thread_context: {
          ...request.available_context.thread_context,
          kind: "missing_or_stale_knowledge_thread",
          source_message_id: null,
          known_source_urls: []
        }
      }
    },
    intent,
    workspaceWriteActive: false
  });

  assert.equal(missingBindingResolved.allow_external_fetch, false);
  assert.equal(missingBindingResolved.allow_knowledge_write, false);
});

test("forum research feature grants external fetch even when legacy mode says chat", () => {
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
      channel_id: "forum-thread-1",
      root_channel_id: "forum-root-1",
      thread_id: "forum-thread-1",
      mode: "chat",
      place_type: "forum_post_thread",
      scope: "server_public"
    },
    message: {
      id: "message-1",
      content: "調べて",
      urls: [],
      created_at: "2026-05-21T00:00:00.000Z"
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
        kind: "plain_thread",
        source_message_id: null,
        known_source_urls: [],
        reply_thread_id: "forum-thread-1",
        root_channel_id: "forum-root-1"
      },
      place_context: {
        features: ["forum_research", "conversation"],
        is_knowledge_place: false
      },
      delivery_context: {
        is_bot_directed: true,
        bot_directed_trigger_kind: "direct_mention"
      },
      discord_runtime_facts_path: null,
      fetchable_public_urls: [],
      blocked_urls: [],
      chat_behavior: null,
      chat_engagement: null,
      recent_room_events: []
    },
    task: {
      kind: "route_message",
      phase: "intent",
      retry_context: null
    }
  } satisfies HarnessRequest;

  const intent = {
    outcome_candidate: "chat_reply",
    repo_write_intent: false,
    requested_external_fetch: "none",
    requested_knowledge_write: false,
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
});

test("workspace-write active does not imply fetch or knowledge write capabilities", () => {
  const request = {
    request_id: "req-1",
    source: {
      adapter: "discord",
      event: "message_create"
    },
    actor: {
      user_id: "admin-1",
      role: "admin"
    },
    place: {
      guild_id: "guild-1",
      channel_id: "override-thread-1",
      root_channel_id: "admin-root-1",
      thread_id: "override-thread-1",
      mode: "admin_control",
      place_type: "public_thread",
      scope: "conversation_only"
    },
    message: {
      id: "message-1",
      content: "コードを直して",
      urls: [],
      created_at: "2026-05-21T00:00:00.000Z"
    },
    capabilities: {
      allow_external_fetch: false,
      allow_knowledge_write: false,
      allow_moderation: false
    },
    override_context: {
      active: true,
      same_actor: true,
      started_by: "admin-1",
      started_at: "2026-05-21T00:00:00.000Z",
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
        kind: "plain_thread",
        source_message_id: null,
        known_source_urls: [],
        reply_thread_id: "override-thread-1",
        root_channel_id: "admin-root-1"
      },
      place_context: {
        features: ["admin_override", "conversation"],
        is_knowledge_place: false
      },
      delivery_context: {
        is_bot_directed: true,
        bot_directed_trigger_kind: "direct_mention"
      },
      discord_runtime_facts_path: null,
      fetchable_public_urls: [],
      blocked_urls: [],
      chat_behavior: "directed_help_chat",
      chat_engagement: null,
      recent_room_events: []
    },
    task: {
      kind: "route_message",
      phase: "intent",
      retry_context: null
    }
  } satisfies HarnessRequest;

  const intent = {
    outcome_candidate: "chat_reply",
    repo_write_intent: true,
    requested_external_fetch: "none",
    requested_knowledge_write: false,
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
    actorRole: "admin",
    request,
    intent,
    workspaceWriteActive: true
  });

  assert.equal(resolved.allow_external_fetch, false);
  assert.equal(resolved.allow_knowledge_write, false);
  assert.equal(resolved.allow_moderation, true);
});
