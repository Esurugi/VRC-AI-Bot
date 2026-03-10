import { z } from "zod";

import {
  SCOPE_VALUES,
  type ActorRole,
  type MessageEnvelope,
  type Scope,
  type WatchLocationConfig
} from "../domain/types.js";

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
    allow_thread_create: boolean;
    allow_external_fetch: boolean;
    allow_knowledge_write: boolean;
    allow_moderation: boolean;
  };
  available_context: {
    thread_context: {
      kind: ThreadContextKind;
      source_message_id: string | null;
      known_source_urls: string[];
      reply_thread_id: string | null;
      root_channel_id: string;
    };
    fetchable_public_urls: string[];
    blocked_urls: string[];
  };
  task: {
    kind: HarnessTaskKind;
  };
};

const persistItemSchema = z.object({
  source_url: z.string().url().nullable(),
  canonical_url: z.string().url().nullable(),
  title: z.string().min(1).nullable(),
  summary: z.string().min(1).nullable(),
  tags: z.array(z.string().min(1)),
  content_hash: z.string().min(1).nullable()
});

export const harnessResponseSchema = z.object({
  outcome: z.enum(HARNESS_OUTCOME_VALUES),
  public_text: z.string().nullable(),
  reply_mode: z.enum(REPLY_MODE_VALUES),
  target_thread_id: z.string().nullable(),
  persist_items: z.array(persistItemSchema),
  diagnostics: z.object({
    notes: z.string().nullable()
  }),
  sensitivity_raise: z.enum(["none", ...SCOPE_VALUES.slice(1)])
});

export type HarnessResponse = z.infer<typeof harnessResponseSchema>;

export const harnessResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "outcome",
    "public_text",
    "reply_mode",
    "target_thread_id",
    "persist_items",
    "diagnostics",
    "sensitivity_raise"
  ],
  properties: {
    outcome: {
      type: "string",
      enum: [...HARNESS_OUTCOME_VALUES]
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
    persist_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "source_url",
          "canonical_url",
          "title",
          "summary",
          "tags",
          "content_hash"
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
          content_hash: { type: ["string", "null"] }
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
    },
    sensitivity_raise: {
      type: "string",
      enum: ["none", ...SCOPE_VALUES.slice(1)]
    }
  }
} as const;
