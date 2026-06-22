import {
  canonicalizeUrl,
  isAllowedPublicHttpUrl
} from "../../playwright/url-policy.js";
import type { PublicUrlAdmission } from "../../harness/contracts.js";

export type PublicUrlAdmissionDecision =
  | {
      admitted: true;
      admission: PublicUrlAdmission;
    }
  | {
      admitted: false;
      original_url: string;
      block_reason: "non_public_or_blocked_http_url";
    };

export function admitPublicUrl(rawUrl: string): PublicUrlAdmissionDecision {
  if (!isAllowedPublicHttpUrl(rawUrl)) {
    return {
      admitted: false,
      original_url: rawUrl,
      block_reason: "non_public_or_blocked_http_url"
    };
  }

  return {
    admitted: true,
    admission: {
      original_url: rawUrl,
      canonical_url: canonicalizeUrl(rawUrl)
    }
  };
}
