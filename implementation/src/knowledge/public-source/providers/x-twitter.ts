import { isAllowedPublicHttpUrl } from "../../../playwright/url-policy.js";
import type {
  PublicFetchCandidate,
  PublicSourceResource
} from "../../../harness/contracts.js";

const X_STATUS_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "fxtwitter.com",
  "fixupx.com",
  "fixvx.com",
  "vxtwitter.com"
]);

export function resolveXTwitterSource(
  originalUrl: string
): {
  resource: PublicSourceResource;
  candidates: PublicFetchCandidate[];
} | null {
  const status = extractXTwitterStatus(originalUrl);
  if (!status) {
    return null;
  }

  const handleOrFallback = status.handle ?? "i/web";
  const canonicalItemUrl = `https://x.com/${handleOrFallback}/status/${status.id}`;
  const resourceId = `x-status:${status.id}`;
  const fxTwitterApiUrl = `https://api.fxtwitter.com/2/status/${status.id}`;
  const jinaReaderUrl = `https://r.jina.ai/${canonicalItemUrl}`;
  const candidateDefinitions: PublicFetchCandidate[] = [
    {
      candidate_id: `${resourceId}:fxtwitter`,
      resource_id: resourceId,
      provider: "x_twitter_fxtwitter",
      original_url: originalUrl,
      canonical_item_url: canonicalItemUrl,
      retrieval_url: fxTwitterApiUrl
    },
    {
      candidate_id: `${resourceId}:jina`,
      resource_id: resourceId,
      provider: "x_twitter_jina",
      original_url: originalUrl,
      canonical_item_url: canonicalItemUrl,
      retrieval_url: jinaReaderUrl
    }
  ];
  const candidates = candidateDefinitions.filter((candidate) =>
    isAllowedPublicHttpUrl(candidate.retrieval_url)
  );

  return {
    resource: {
      resource_id: resourceId,
      provider: "x_status",
      original_url: originalUrl,
      canonical_item_url: canonicalItemUrl
    },
    candidates
  };
}

function extractXTwitterStatus(rawUrl: string): {
  id: string;
  handle: string | null;
} | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!X_STATUS_HOSTS.has(hostname)) {
    return null;
  }

  const match =
    parsed.pathname.match(/^\/[^/]+\/status(?:es)?\/(\d+)(?:\/|$)/i) ??
    parsed.pathname.match(/^\/i\/web\/status(?:es)?\/(\d+)(?:\/|$)/i);
  if (!match?.[1]) {
    return null;
  }

  const firstPathSegment = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  const handle =
    firstPathSegment && firstPathSegment.toLowerCase() !== "i"
      ? firstPathSegment
      : null;

  return {
    id: match[1],
    handle
  };
}
