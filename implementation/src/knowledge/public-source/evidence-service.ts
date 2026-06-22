import type { Logger } from "pino";

import type {
  PublicFetchCandidate,
  PublicSourceFact,
  PublicSourceFailure
} from "../../harness/contracts.js";
import {
  canonicalizeUrl,
  isAllowedPublicHttpUrl
} from "../../playwright/url-policy.js";
import {
  fetchPublicSource,
  type PublicSourceFetchResult
} from "../public-source-fetch.js";

export type PublicSourceFetcher = (
  url: string
) => Promise<PublicSourceFetchResult>;

export async function acquirePublicSourceEvidence(input: {
  allowExternalFetch: boolean;
  candidates: PublicFetchCandidate[];
  existingFacts: PublicSourceFact[];
  existingFailures: PublicSourceFailure[];
  logger: Pick<Logger, "debug">;
  fetcher: PublicSourceFetcher | undefined;
}): Promise<{
  facts: PublicSourceFact[];
  failures: PublicSourceFailure[];
}> {
  if (!input.allowExternalFetch) {
    return {
      facts: input.existingFacts,
      failures: input.existingFailures
    };
  }

  const fetcher = input.fetcher ?? fetchPublicSource;
  const facts = [...input.existingFacts];
  const failures = [...input.existingFailures];
  const existingFactResourceIds = new Set(facts.map((fact) => fact.resource_id));
  const candidatesByResource = groupCandidatesByResource(input.candidates);

  for (const [resourceId, candidates] of candidatesByResource) {
    if (existingFactResourceIds.has(resourceId)) {
      continue;
    }

    for (const candidate of candidates) {
      const attempt = await fetchCandidate(candidate, fetcher, input.logger);
      if (attempt.kind === "fact") {
        facts.push(attempt.fact);
        existingFactResourceIds.add(resourceId);
        break;
      }
      failures.push(attempt.failure);
    }
  }

  return {
    facts: dedupeBy(facts, (fact) => fact.fact_id),
    failures: dedupeBy(failures, (failure) => failure.failure_id)
  };
}

async function fetchCandidate(
  candidate: PublicFetchCandidate,
  fetcher: PublicSourceFetcher,
  logger: Pick<Logger, "debug">
): Promise<
  | {
      kind: "fact";
      fact: PublicSourceFact;
    }
  | {
      kind: "failure";
      failure: PublicSourceFailure;
    }
> {
  try {
    const result = await fetcher(candidate.retrieval_url);
    const failureReason = getResultFailureReason(candidate, result);
    if (failureReason) {
      return {
        kind: "failure",
        failure: toFailure(candidate, result.status, failureReason)
      };
    }

    const text = result.text?.trim() ?? "";
    return {
      kind: "fact",
      fact: {
        fact_id: `fact:${candidate.candidate_id}`,
        resource_id: candidate.resource_id,
        candidate_id: candidate.candidate_id,
        provider: candidate.provider,
        original_url: candidate.original_url,
        canonical_item_url: candidate.canonical_item_url,
        retrieval_url: canonicalizeUrl(candidate.retrieval_url),
        observed_url: canonicalizeUrl(result.finalUrl),
        status: result.status,
        content_type: result.contentType,
        title: result.title?.trim() || null,
        text
      }
    };
  } catch (error) {
    logger.debug(
      {
        candidateId: candidate.candidate_id,
        retrievalUrl: candidate.retrieval_url,
        error: error instanceof Error ? error.message : String(error)
      },
      "public source candidate fetch failed"
    );
    return {
      kind: "failure",
      failure: toFailure(
        candidate,
        null,
        error instanceof Error ? error.message : String(error)
      )
    };
  }
}

function getResultFailureReason(
  candidate: PublicFetchCandidate,
  result: PublicSourceFetchResult
): string | null {
  if (!isAllowedPublicHttpUrl(result.finalUrl)) {
    return "final URL is not a public HTTP(S) URL";
  }

  if (result.status < 200 || result.status >= 400) {
    return `HTTP status ${result.status}`;
  }

  if (
    candidate.provider === "x_twitter_fxtwitter" &&
    typeof result.fxTwitterCode === "number" &&
    result.fxTwitterCode !== 200
  ) {
    return `FxTwitter code ${result.fxTwitterCode}`;
  }

  if (!result.text?.trim()) {
    return "empty public source text";
  }

  return null;
}

function toFailure(
  candidate: PublicFetchCandidate,
  status: number | null,
  reason: string
): PublicSourceFailure {
  return {
    failure_id: `failure:${candidate.candidate_id}:${status ?? "error"}:${reason}`,
    resource_id: candidate.resource_id,
    candidate_id: candidate.candidate_id,
    provider: candidate.provider,
    original_url: candidate.original_url,
    canonical_item_url: candidate.canonical_item_url,
    retrieval_url: canonicalizeUrl(candidate.retrieval_url),
    status,
    reason
  };
}

function groupCandidatesByResource(
  candidates: PublicFetchCandidate[]
): Map<string, PublicFetchCandidate[]> {
  const grouped = new Map<string, PublicFetchCandidate[]>();
  for (const candidate of candidates) {
    const group = grouped.get(candidate.resource_id) ?? [];
    group.push(candidate);
    grouped.set(candidate.resource_id, group);
  }
  return grouped;
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
