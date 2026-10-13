import type { HarnessRequest, PublicSourceFact, PublicSourceFailure } from "../harness/contracts.js";

export type PublicResearchProgress = {
  message: string;
  evidence_fact_ids: string[];
};

/** Host-provided authority and callbacks. Never deserialize this from model input. */
export type TurnExecutionContext = {
  signal?: AbortSignal;
  publicSources?: {
    allowExternalFetch: boolean;
    blockedUrls: string[];
    allowedSources?: string[];
  };
  onPublicSourceEvidence?: (result: {
    facts: PublicSourceFact[];
    failures: PublicSourceFailure[];
  }) => void;
  onResearchProgress?: (notice: PublicResearchProgress) => void | Promise<void>;
  readResearchEvidence?: (factId: string) => PublicSourceFact;
};

export const researchEvidenceToolSpec = {
  name: "vrc_read_research_evidence",
  description: "Read an already acquired original source page by fact_id from this research run's source catalog. Returns the complete host fact, including its original text and text_range. This does not fetch the network or accept historical/foreign fact IDs. Choose the pages needed to check claims, conditions and counterevidence; all acquired pages remain readable.",
  inputSchema: {
    type: "object", properties: { fact_id: { type: "string" } },
    required: ["fact_id"], additionalProperties: false
  }
};

export function executionContextForHarnessRequest(request: HarnessRequest): TurnExecutionContext {
  if (request.task.phase === "intent") return {};
  const retry = request.task.retry_context;
  return {
    publicSources: {
      allowExternalFetch: request.capabilities.allow_external_fetch,
      blockedUrls: request.available_context.blocked_urls,
      ...(retry?.kind === "output_safety" && !request.available_context.place_context.features.includes("forum_research")
        ? { allowedSources: retry.allowed_sources } : {})
    }
  };
}

export const researchProgressToolSpec = {
  name: "vrc_report_research_progress",
  description: "Report a useful research milestone while continuing your research. Give a short public-facing Japanese message describing confirmed findings, remaining questions or the reason for deeper research. Cite host evidence_fact_ids for findings. Use an empty list only for plans or questions, not factual assertions. Do not expose internal reasoning or invent progress percentages. This reports progress; it does not finish the research.",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      evidence_fact_ids: { type: "array", items: { type: "string" } }
    },
    required: ["message", "evidence_fact_ids"],
    additionalProperties: false
  }
};
