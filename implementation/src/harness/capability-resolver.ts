import type { ActorRole } from "../domain/types.js";
import type { HarnessIntentResponse, HarnessRequest } from "./contracts.js";

export type ResolvedCapabilities = HarnessRequest["capabilities"];

export function resolveHarnessCapabilities(input: {
  actorRole: ActorRole;
  request: HarnessRequest;
  intent: HarnessIntentResponse;
  workspaceWriteActive: boolean;
}): ResolvedCapabilities {
  if (input.workspaceWriteActive) {
    return {
      allow_external_fetch: true,
      allow_knowledge_write: true,
      allow_moderation: true
    };
  }

  const allowExternalFetch = shouldGrantExternalFetch(input.request, input.intent);

  return {
    allow_external_fetch: allowExternalFetch,
    allow_knowledge_write: shouldGrantKnowledgeWrite(input.intent, allowExternalFetch),
    allow_moderation: input.actorRole !== "user"
  };
}

function shouldGrantKnowledgeWrite(
  intent: HarnessIntentResponse,
  allowExternalFetch: boolean
): boolean {
  return (
    intent.outcome_candidate === "knowledge_ingest" &&
    intent.requested_knowledge_write &&
    allowExternalFetch
  );
}

function shouldGrantExternalFetch(
  request: HarnessRequest,
  intent: HarnessIntentResponse
): boolean {
  switch (intent.requested_external_fetch) {
    case "none":
      return false;
    case "message_urls":
      return request.available_context.fetchable_public_urls.length > 0;
    case "known_thread_sources":
      return (
        request.available_context.thread_context.kind === "knowledge_thread" &&
        request.available_context.thread_context.known_source_urls.length > 0
      );
    case "public_research":
      return true;
  }
}
