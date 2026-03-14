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

export const forumResearchPlanSchema = z.object({
  progress_notice: z.string().min(1).nullable(),
  effective_user_text: z.string().min(1).nullable(),
  worker_tasks: z.array(forumResearchWorkerTaskSchema).max(
    FORUM_RESEARCH_MAX_WORKERS
  ),
  synthesis_brief: z.string().min(1),
  evidence_gaps: z.array(z.string().min(1)).max(8)
});

export type ForumResearchPlan = z.infer<typeof forumResearchPlanSchema>;

export const forumResearchWorkerCitationSchema = z.object({
  url: z.string().url(),
  claim: z.string().min(1)
});

export type ForumResearchWorkerCitation = z.infer<
  typeof forumResearchWorkerCitationSchema
>;

export const forumResearchWorkerResultSchema = z.object({
  worker_id: z.string().min(1),
  subquestion: z.string().min(1),
  findings: z.array(z.string().min(1)),
  citations: z.array(forumResearchWorkerCitationSchema),
  unresolved: z.array(z.string().min(1)),
  confidence: z.enum(["high", "medium", "low"])
});

export type ForumResearchWorkerResult = z.infer<
  typeof forumResearchWorkerResultSchema
>;

export type ForumResearchSourceCatalogEntry = {
  index: number;
  url: string;
  claims: string[];
};

export type ForumResearchBundle = {
  plan: ForumResearchPlan;
  workerResults: ForumResearchWorkerResult[];
  distinctSourceTarget: number;
  distinctSources: string[];
  sourceCatalog: ForumResearchSourceCatalogEntry[];
};

export type PersistedForumResearchState = {
  sessionIdentity: string;
  threadId: string;
  lastMessageId: string;
  plannerBrief: string | null;
  evidenceGaps: string[];
  workerResults: ForumResearchWorkerResult[];
  sourceCatalog: ForumResearchSourceCatalogEntry[];
  distinctSources: string[];
};

export const forumResearchPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "progress_notice",
    "effective_user_text",
    "worker_tasks",
    "synthesis_brief",
    "evidence_gaps"
  ],
  properties: {
    progress_notice: {
      type: ["string", "null"]
    },
    effective_user_text: {
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
    synthesis_brief: {
      type: "string"
    },
    evidence_gaps: {
      type: "array",
      maxItems: 8,
      items: {
        type: "string"
      }
    }
  }
} as const;

export const forumResearchWorkerResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "worker_id",
    "subquestion",
    "findings",
    "citations",
    "unresolved",
    "confidence"
  ],
  properties: {
    worker_id: { type: "string" },
    subquestion: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "string"
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
    },
    unresolved: {
      type: "array",
      items: {
        type: "string"
      }
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"]
    }
  }
} as const;
