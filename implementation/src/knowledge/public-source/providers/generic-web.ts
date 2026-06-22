import type {
  PublicFetchCandidate,
  PublicSourceResource,
  PublicUrlAdmission
} from "../../../harness/contracts.js";

export function resolveGenericWebSource(admission: PublicUrlAdmission): {
  resource: PublicSourceResource;
  candidates: PublicFetchCandidate[];
} {
  const resourceId = `web:${admission.canonical_url}`;
  const resource: PublicSourceResource = {
    resource_id: resourceId,
    provider: "generic_web",
    original_url: admission.original_url,
    canonical_item_url: admission.canonical_url
  };

  return {
    resource,
    candidates: [
      {
        candidate_id: `${resourceId}:direct`,
        resource_id: resourceId,
        provider: "generic_web",
        original_url: admission.original_url,
        canonical_item_url: admission.canonical_url,
        retrieval_url: admission.canonical_url
      }
    ]
  };
}
