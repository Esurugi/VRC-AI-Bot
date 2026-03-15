import { z } from "zod";

export const FORUM_RESEARCH_DISTINCT_SOURCE_TARGET = 8;
export const FORUM_RESEARCH_MAX_WORKERS = 4;

export const forumResearchWorkerTaskSchema = z.object({
  worker_id: z.string().min(1),
  question: z.string().min(1),
  search_focus: z.string().min(1),
  must_cover: z.array(z.string().min(1)).max(4),
  min_sources: z.number().int().min(1).max(5),
  max_sources: z.number().int().min(1).max(5)
});

export type ForumResearchWorkerTask = z.infer<
  typeof forumResearchWorkerTaskSchema
>;

export const forumResearchSupervisorActionSchema = z.enum([
  "launch_workers",
  "finalize"
]);

export type ForumResearchSupervisorAction = z.infer<
  typeof forumResearchSupervisorActionSchema
>;

export const promptRefinementArtifactSchema = z.object({
  refined_prompt: z.string().min(1),
  progress_notice: z.string().min(1).nullable(),
  prompt_rationale_summary: z.string().min(1).nullable()
});

export type PromptRefinementArtifact = z.infer<
  typeof promptRefinementArtifactSchema
>;

export const forumResearchSupervisorDecisionSchema = z.object({
  progress_notice: z.string().min(1).nullable(),
  worker_tasks: z.array(forumResearchWorkerTaskSchema).max(
    FORUM_RESEARCH_MAX_WORKERS
  ),
  interrupts: z.array(z.string().min(1)).max(FORUM_RESEARCH_MAX_WORKERS),
  next_action: forumResearchSupervisorActionSchema,
  final_brief: z.string().min(1).nullable()
});

export type ForumResearchSupervisorDecision = z.infer<
  typeof forumResearchSupervisorDecisionSchema
>;

export const forumResearchWorkerCitationSchema = z.object({
  url: z.string().url(),
  claim: z.string().min(1)
});

export type ForumResearchWorkerCitation = z.infer<
  typeof forumResearchWorkerCitationSchema
>;

export const forumResearchEvidenceItemSchema = z.object({
  claim: z.string().min(1),
  source_urls: z.array(z.string().url()).min(1).max(5)
});

export type ForumResearchEvidenceItem = z.infer<
  typeof forumResearchEvidenceItemSchema
>;

export const forumResearchWorkerPacketSchema = z.object({
  worker_id: z.string().min(1),
  subquestion: z.string().min(1),
  evidence_items: z.array(forumResearchEvidenceItemSchema),
  citations: z.array(forumResearchWorkerCitationSchema)
});

export type ForumResearchWorkerPacket = z.infer<
  typeof forumResearchWorkerPacketSchema
>;

export type ForumResearchSourceCatalogEntry = {
  index: number;
  url: string;
  claims: string[];
};

export type ForumResearchBundle = {
  evidenceItems: ForumResearchEvidenceItem[];
  currentWorkerPackets: ForumResearchWorkerPacket[];
  distinctSourceTarget: number;
  distinctSources: string[];
  sourceCatalog: ForumResearchSourceCatalogEntry[];
};

export type PersistedForumResearchState = {
  sessionIdentity: string;
  threadId: string;
  lastMessageId: string;
  evidenceItems: ForumResearchEvidenceItem[];
  sourceCatalog: ForumResearchSourceCatalogEntry[];
  distinctSources: string[];
};

export type PersistedPromptRefinementArtifact = {
  sessionIdentity: string;
  threadId: string;
  lastMessageId: string;
  refinedPrompt: string;
  progressNotice: string | null;
  promptRationaleSummary: string | null;
};

export const promptRefinementArtifactJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["refined_prompt", "progress_notice", "prompt_rationale_summary"],
  properties: {
    refined_prompt: {
      type: "string"
    },
    progress_notice: {
      type: ["string", "null"]
    },
    prompt_rationale_summary: {
      type: ["string", "null"]
    }
  }
} as const;

export const forumResearchSupervisorDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "progress_notice",
    "worker_tasks",
    "interrupts",
    "next_action",
    "final_brief"
  ],
  properties: {
    progress_notice: {
      type: ["string", "null"]
    },
    worker_tasks: {
      type: "array",
      minItems: 0,
      maxItems: FORUM_RESEARCH_MAX_WORKERS,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "worker_id",
          "question",
          "search_focus",
          "must_cover",
          "min_sources",
          "max_sources"
        ],
        properties: {
          worker_id: { type: "string" },
          question: { type: "string" },
          search_focus: { type: "string" },
          must_cover: {
            type: "array",
            maxItems: 4,
            items: {
              type: "string"
            }
          },
          min_sources: { type: "integer" },
          max_sources: { type: "integer" }
        }
      }
    },
    interrupts: {
      type: "array",
      minItems: 0,
      maxItems: FORUM_RESEARCH_MAX_WORKERS,
      items: {
        type: "string"
      }
    },
    next_action: {
      type: "string",
      enum: ["launch_workers", "finalize"]
    },
    final_brief: {
      type: ["string", "null"]
    }
  }
} as const;

export const forumResearchWorkerPacketJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["worker_id", "subquestion", "evidence_items", "citations"],
  properties: {
    worker_id: { type: "string" },
    subquestion: { type: "string" },
    evidence_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "source_urls"],
        properties: {
          claim: { type: "string" },
          source_urls: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: {
              type: "string"
            }
          }
        }
      }
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "claim"],
        properties: {
          url: { type: "string" },
          claim: { type: "string" }
        }
      }
    }
  }
} as const;
