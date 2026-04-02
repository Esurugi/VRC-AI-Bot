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

export const HARNESS_TASK_PHASE_VALUES = [
  "intent",
  "answer",
  "retry"
] as const;
export type HarnessTaskPhase = (typeof HARNESS_TASK_PHASE_VALUES)[number];

export const RETRY_CONTEXT_KIND_VALUES = [
  "output_safety",
  "knowledge_followup_non_silent"
] as const;
export type RetryContextKind = (typeof RETRY_CONTEXT_KIND_VALUES)[number];

export const REQUESTED_EXTERNAL_FETCH_VALUES = [
  "none",
  "message_urls",
  "known_thread_sources",
  "public_research"
] as const;
export type RequestedExternalFetch =
  (typeof REQUESTED_EXTERNAL_FETCH_VALUES)[number];

export const MODERATION_VIOLATION_CATEGORY_VALUES = [
  "none",
  "dangerous",
  "prohibited"
] as const;
export type ModerationViolationCategory =
  (typeof MODERATION_VIOLATION_CATEGORY_VALUES)[number];

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
    place_context: {
      is_knowledge_place: boolean;
    };
    delivery_context: {
      is_bot_directed: boolean;
      bot_directed_trigger_kind:
        | "direct_mention"
        | "reply_to_bot"
        | null;
    };
    discord_runtime_facts_path: string | null;
    fetchable_public_urls: string[];
    blocked_urls: string[];
    chat_behavior: "ambient_room_chat" | "directed_help_chat" | null;
    chat_engagement: {
      trigger_kind:
        | "direct_mention"
        | "reply_to_bot"
        | "question_marker"
        | "sparse_periodic"
        | "ambient_room";
      is_directed_to_bot: boolean;
      sparse_ordinal: number | null;
      ordinary_message_count: number | null;
    } | null;
    recent_room_events: Array<{
      message_id: string;
      author: string;
      is_bot: boolean;
      reply_to_message_id: string | null;
      mentions_bot: boolean;
      content: string;
    }>;
  };
  task: {
    kind: HarnessTaskKind;
    phase: HarnessTaskPhase;
    retry_context:
      | {
          kind: "output_safety";
          reason: string;
          allowed_sources: string[];
          disallowed_sources: string[];
          retry_count: number;
        }
      | {
          kind: "knowledge_followup_non_silent";
          retry_count: number;
        }
      | null;
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
  diagnostics: z.object({
    notes: z.string().nullable()
  }),
  sensitivity_raise: z.enum(["none", ...SCOPE_VALUES.slice(1)])
});

export type HarnessResponse = z.infer<typeof harnessResponseSchema>;

export const harnessIntentResponseSchema = z.object({
  outcome_candidate: z.enum(HARNESS_OUTCOME_VALUES),
  repo_write_intent: z.boolean(),
  requested_external_fetch: z.enum(REQUESTED_EXTERNAL_FETCH_VALUES),
  requested_knowledge_write: z.boolean(),
  moderation_signal: z.object({
    violation_category: z.enum(MODERATION_VIOLATION_CATEGORY_VALUES),
    control_request_class: z.string().min(1).nullable(),
    notes: z.string().nullable()
  }),
  diagnostics: z.object({
    notes: z.string().nullable()
  })
});

export type HarnessIntentResponse = z.infer<typeof harnessIntentResponseSchema>;

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

export const harnessIntentResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "outcome_candidate",
    "repo_write_intent",
    "requested_external_fetch",
    "requested_knowledge_write",
    "moderation_signal",
    "diagnostics"
  ],
  properties: {
    outcome_candidate: {
      type: "string",
      enum: [...HARNESS_OUTCOME_VALUES]
    },
    repo_write_intent: {
      type: "boolean"
    },
    requested_external_fetch: {
      type: "string",
      enum: [...REQUESTED_EXTERNAL_FETCH_VALUES]
    },
    requested_knowledge_write: {
      type: "boolean"
    },
    moderation_signal: {
      type: "object",
      additionalProperties: false,
      required: [
        "violation_category",
        "control_request_class",
        "notes"
      ],
      properties: {
        violation_category: {
          type: "string",
          enum: [...MODERATION_VIOLATION_CATEGORY_VALUES]
        },
        control_request_class: {
          type: ["string", "null"]
        },
        notes: {
          type: ["string", "null"]
        }
      }
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


