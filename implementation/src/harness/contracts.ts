import { z } from "zod";

import {
  SCOPE_VALUES,
  type ActorRole,
  type MessageEnvelope,
  type Scope,
  type WatchLocationConfig
} from "../domain/types.js";
import { DEFAULT_OVERRIDE_FLAGS } from "../override/types.js";

export const HARNESS_OUTCOME_VALUES = [
  "chat_reply",
  "knowledge_ingest",
  "admin_diagnostics",
  "ignore",
  "failure"
] as const;
export type HarnessOutcome = (typeof HARNESS_OUTCOME_VALUES)[number];

export const REPLY_MODE_VALUES = [
  "same_place",
  "create_public_thread",
  "reuse_existing_thread",
  "no_reply"
] as const;
export type ReplyMode = (typeof REPLY_MODE_VALUES)[number];

export const HARNESS_TASK_KIND_VALUES = [
  "route_message",
  "knowledge_ingest"
] as const;
export type HarnessTaskKind = (typeof HARNESS_TASK_KIND_VALUES)[number];

export const THREAD_CONTEXT_KIND_VALUES = [
  "root_channel",
  "knowledge_thread",
  "plain_thread"
] as const;
export type ThreadContextKind = (typeof THREAD_CONTEXT_KIND_VALUES)[number];

export type HarnessRequest = {
  request_id: string;
  source: {
    adapter: "discord";
    event: "message_create";
  };
  actor: {
    user_id: string;
    role: ActorRole;
  };
  place: {
    guild_id: string;
    channel_id: string;
    root_channel_id: string;
    thread_id: string | null;
    mode: WatchLocationConfig["mode"];
    place_type: MessageEnvelope["placeType"];
    scope: Scope;
  };
  message: {
    id: string;
    content: string;
    urls: string[];
    created_at: string;
  };
  capabilities: {
    allow_external_fetch: boolean;
    allow_knowledge_write: boolean;
    allow_moderation: boolean;
  };
  override_context: {
    active: boolean;
    same_actor: boolean;
    started_by: string | null;
    started_at: string | null;
    flags: {
      allow_playwright_headed: boolean;
      allow_playwright_persistent: boolean;
      allow_prompt_injection_test: boolean;
      suspend_violation_counter_for_current_thread: boolean;
      allow_external_fetch_in_private_context_without_private_terms: boolean;
    };
  };
  available_context: {
    thread_context: {
      kind: ThreadContextKind;
      source_message_id: string | null;
      known_source_urls: string[];
      reply_thread_id: string | null;
      root_channel_id: string;
    };
    discord_runtime_facts_path: string | null;
    fetchable_public_urls: string[];
    blocked_urls: string[];
  };
  task: {
    kind: HarnessTaskKind;
  };
};

const knowledgeWriteSchema = z.object({
  source_url: z.string().url().nullable(),
  canonical_url: z.string().url().nullable(),
  title: z.string().min(1).nullable(),
  summary: z.string().min(1).nullable(),
  tags: z.array(z.string().min(1)),
  content_hash: z.string().min(1).nullable(),
  normalized_text: z.string().min(1).nullable(),
  source_kind: z.string().min(1).nullable()
});

export const harnessResponseSchema = z.object({
  outcome: z.enum(HARNESS_OUTCOME_VALUES),
  repo_write_intent: z.boolean(),
  public_text: z.string().nullable(),
  reply_mode: z.enum(REPLY_MODE_VALUES),
  target_thread_id: z.string().nullable(),
  selected_source_ids: z.array(z.string().min(1)),
  sources_used: z.array(z.string().min(1)),
  knowledge_writes: z.array(knowledgeWriteSchema),
  persist_items: z.array(knowledgeWriteSchema).optional().default([]),
  diagnostics: z.object({
    notes: z.string().nullable()
  }),
  sensitivity_raise: z.enum(["none", ...SCOPE_VALUES.slice(1)])
});

export type HarnessResponse = z.infer<typeof harnessResponseSchema>;

const knowledgeWriteJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_url",
    "canonical_url",
    "title",
    "summary",
    "tags",
    "content_hash",
    "normalized_text",
    "source_kind"
  ],
  properties: {
    source_url: { type: ["string", "null"] },
    canonical_url: { type: ["string", "null"] },
    title: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
    tags: {
      type: "array",
      items: {
        type: "string"
      }
    },
    content_hash: { type: ["string", "null"] },
    normalized_text: { type: ["string", "null"] },
    source_kind: { type: ["string", "null"] }
  }
} as const;

export const harnessResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "outcome",
    "repo_write_intent",
    "public_text",
    "reply_mode",
    "target_thread_id",
    "selected_source_ids",
    "sources_used",
    "knowledge_writes",
    "persist_items",
    "diagnostics",
    "sensitivity_raise"
  ],
  properties: {
    outcome: {
      type: "string",
      enum: [...HARNESS_OUTCOME_VALUES]
    },
    repo_write_intent: {
      type: "boolean"
    },
    public_text: {
      type: ["string", "null"]
    },
    reply_mode: {
      type: "string",
      enum: [...REPLY_MODE_VALUES]
    },
    target_thread_id: {
      type: ["string", "null"]
    },
    selected_source_ids: {
      type: "array",
      items: {
        type: "string"
      }
    },
    sources_used: {
      type: "array",
      items: {
        type: "string"
      }
    },
    knowledge_writes: {
      type: "array",
      items: knowledgeWriteJsonSchema
    },
    persist_items: {
      type: "array",
      items: knowledgeWriteJsonSchema
    },
    diagnostics: {
      type: "object",
      additionalProperties: false,
      required: ["notes"],
      properties: {
        notes: {
          type: ["string", "null"]
        }
      }
    },
    sensitivity_raise: {
      type: "string",
      enum: ["none", ...SCOPE_VALUES.slice(1)]
    }
  }
} as const;

export const defaultHarnessOverrideContext = {
  active: false,
  same_actor: false,
  started_by: null,
  started_at: null,
  flags: {
    allow_playwright_headed: DEFAULT_OVERRIDE_FLAGS.allowPlaywrightHeaded,
    allow_playwright_persistent: DEFAULT_OVERRIDE_FLAGS.allowPlaywrightPersistent,
    allow_prompt_injection_test: DEFAULT_OVERRIDE_FLAGS.allowPromptInjectionTest,
    suspend_violation_counter_for_current_thread:
      DEFAULT_OVERRIDE_FLAGS.suspendViolationCounterForCurrentThread,
    allow_external_fetch_in_private_context_without_private_terms:
      DEFAULT_OVERRIDE_FLAGS.allowExternalFetchInPrivateContextWithoutPrivateTerms
  }
};


