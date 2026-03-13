import {
  canonicalizeUrl,
  isAllowedPublicHttpUrl
} from "../playwright/url-policy.js";

export type PublicSourceFetchResult = {
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string;
  public: true;
  status: number;
};

export async function fetchPublicSource(
  requestedUrl: string
): Promise<PublicSourceFetchResult> {
  if (!isAllowedPublicHttpUrl(requestedUrl)) {
    throw new Error("requested URL is not a public HTTP(S) URL");
  }

  const response = await fetch(requestedUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      "user-agent": "VRC-AI-Bot-public-source-fetch/1.0"
    }
  });

  const finalUrl = response.url || requestedUrl;
  if (!isAllowedPublicHttpUrl(finalUrl)) {
    throw new Error("final URL is not a public HTTP(S) URL");
  }
  if (!response.ok) {
    throw new Error(`public fetch failed with status ${response.status}`);
  }

  await response.body?.cancel().catch(() => {});

  return {
    requestedUrl,
    finalUrl,
    canonicalUrl: canonicalizeUrl(finalUrl),
    public: true,
    status: response.status
  };
}
