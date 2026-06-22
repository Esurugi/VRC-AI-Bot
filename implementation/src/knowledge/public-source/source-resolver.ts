import type {
  PublicFetchCandidate,
  PublicSourceFailure,
  PublicSourceFact,
  PublicSourceResource,
  PublicUrlAdmission
} from "../../harness/contracts.js";
import { admitPublicUrl } from "./url-admission.js";
import { resolveGenericWebSource } from "./providers/generic-web.js";
import { resolveXTwitterSource } from "./providers/x-twitter.js";

export type PublicSourceContext = {
  approved_public_urls: PublicUrlAdmission[];
  public_source_resources: PublicSourceResource[];
  readable_public_url_candidates: PublicFetchCandidate[];
  public_source_facts: PublicSourceFact[];
  public_source_failures: PublicSourceFailure[];
  blocked_urls: string[];
};

export function buildPublicSourceContext(input: {
  urls: string[];
  publicSourceFacts?: PublicSourceFact[];
  publicSourceFailures?: PublicSourceFailure[];
}): PublicSourceContext {
  const approvedPublicUrls: PublicUrlAdmission[] = [];
  const resources: PublicSourceResource[] = [];
  const candidates: PublicFetchCandidate[] = [];
  const blockedUrls: string[] = [];

  for (const url of input.urls) {
    const admission = admitPublicUrl(url);
    if (!admission.admitted) {
      blockedUrls.push(admission.original_url);
      continue;
    }

    approvedPublicUrls.push(admission.admission);
    const resolved =
      resolveXTwitterSource(admission.admission.original_url) ??
      resolveGenericWebSource(admission.admission);
    resources.push(resolved.resource);
    candidates.push(...resolved.candidates);
  }

  return {
    approved_public_urls: dedupeBy(approvedPublicUrls, (item) => item.canonical_url),
    public_source_resources: dedupeBy(resources, (item) => item.resource_id),
    readable_public_url_candidates: dedupeBy(
      candidates,
      (item) => item.candidate_id
    ),
    public_source_facts: dedupeBy(
      input.publicSourceFacts ?? [],
      (item) => item.fact_id
    ),
    public_source_failures: dedupeBy(
      input.publicSourceFailures ?? [],
      (item) => item.failure_id
    ),
    blocked_urls: [...new Set(blockedUrls)]
  };
}

function dedupeBy<T>(values: T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}
