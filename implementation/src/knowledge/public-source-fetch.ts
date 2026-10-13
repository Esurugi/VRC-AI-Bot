import {
  canonicalizeUrl,
  isAllowedPublicHttpUrl
} from "../playwright/url-policy.js";
import { publicHttpGet } from "./public-source/public-http.js";
import { fetchYoutubeTranscript, youtubeVideoId } from "./public-source/youtube-transcript.js";

export type PublicSourceFetchResult = {
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string;
  public: true;
  status: number;
  contentType: string | null;
  title: string | null;
  text: string | null;
  fxTwitterCode?: number | null;
  transcript?: { language: string; automatic: boolean };
  retrievalUrl?: string;
};

export async function fetchPublicSource(
  requestedUrl: string,
  transport = publicHttpGet
): Promise<PublicSourceFetchResult> {
  if (!isAllowedPublicHttpUrl(requestedUrl)) {
    throw new Error("requested URL is not a public HTTP(S) URL");
  }

  const videoId = youtubeVideoId(requestedUrl);
  if (videoId) return fetchYoutubeTranscript(requestedUrl, videoId);
  const response = await transport(requestedUrl);

  const finalUrl = response.finalUrl;
  if (!isAllowedPublicHttpUrl(finalUrl)) {
    throw new Error("final URL is not a public HTTP(S) URL");
  }
  const contentType = response.contentType;
  const bodyText = response.body;
  const extracted = extractPublicSourceText(bodyText, contentType);
  const effectiveStatus =
    extractJinaReaderTargetStatus(bodyText, finalUrl) ?? response.status;

  return {
    requestedUrl,
    finalUrl,
    canonicalUrl: canonicalizeUrl(finalUrl),
    public: true,
    status: effectiveStatus,
    contentType,
    title: extracted.title,
    text: extracted.text,
    fxTwitterCode: extractFxTwitterCode(bodyText, finalUrl)
  };
}

export function extractPublicSourceText(
  bodyText: string,
  contentType: string | null
): { title: string | null; text: string | null } {
  const normalizedContentType = contentType?.toLowerCase() ?? "";
  if (normalizedContentType.includes("application/json")) {
    return extractJsonPublicSourceText(bodyText);
  }

  if (
    normalizedContentType.startsWith("text/") ||
    normalizedContentType.includes("application/xhtml+xml") ||
    normalizedContentType.includes("application/xml")
  ) {
    return {
      title: extractHtmlTitle(bodyText),
      text: limitText(normalizedContentType.includes("html") ? normalizeWhitespace(stripHtml(bodyText)) : bodyText)
    };
  }

  return {
    title: null,
    text: null
  };
}

function extractJsonPublicSourceText(bodyText: string): {
  title: string | null;
  text: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return {
      title: null,
      text: limitText(normalizeWhitespace(bodyText))
    };
  }

  const fxTwitter = extractFxTwitterStatusText(parsed);
  if (fxTwitter.text) {
    return fxTwitter;
  }

  const generic = collectGenericJsonText(parsed);
  return {
    title: generic.title,
    text: limitText(generic.lines.join("\n"))
  };
}

function extractFxTwitterStatusText(parsed: unknown): {
  title: string | null;
  text: string | null;
} {
  if (!isRecord(parsed)) {
    return {
      title: null,
      text: null
    };
  }

  const status = isRecord(parsed.status)
    ? parsed.status
    : isRecord(parsed.tweet)
      ? parsed.tweet
      : null;
  if (!status) {
    return {
      title: null,
      text: null
    };
  }

  const author = isRecord(status.author) ? status.author : null;
  const authorName = readString(author?.name);
  const screenName =
    readString(author?.screen_name) ?? readString(author?.screenName);
  const statusText =
    readString(status.text) ??
    readString(status.full_text) ??
    (isRecord(status.raw_text) ? readString(status.raw_text.text) : null);

  if (!statusText) {
    return {
      title: null,
      text: null
    };
  }

  const title =
    authorName && screenName
      ? `${authorName} (@${screenName})`
      : authorName ?? (screenName ? `@${screenName}` : "X/Twitter status");
  const text = `${title}:\n${statusText}`;

  return {
    title,
    text: limitText(text)
  };
}

function collectGenericJsonText(parsed: unknown): {
  title: string | null;
  lines: string[];
} {
  const lines: string[] = [];
  let title: string | null = null;

  function visit(value: unknown, key: string | null, depth: number): void {
    if (depth > 16) {
      return;
    }

    if (typeof value === "string") {
      const normalized = normalizeWhitespace(value);
      if (!normalized) {
        return;
      }
      if (!title && key && /^(title|name)$/i.test(key)) {
        title = normalized;
      }
      if (/^(title|name|text|full_text|description|summary|content)$/i.test(key ?? "")) {
        lines.push(normalized);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, key, depth + 1);
      }
      return;
    }

    if (isRecord(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, childKey, depth + 1);
      }
    }
  }

  visit(parsed, null, 0);
  return {
    title,
    lines: dedupeStrings(lines)
  };
}

function extractHtmlTitle(value: string): string | null {
  const match = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? normalizeWhitespace(stripHtml(match[1])) : null;
}

function extractFxTwitterCode(bodyText: string, finalUrl: string): number | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(finalUrl);
  } catch {
    return null;
  }

  if (parsedUrl.hostname.toLowerCase() !== "api.fxtwitter.com") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const code = parsed.code;
  if (typeof code === "number" && Number.isFinite(code)) {
    return code;
  }
  if (typeof code === "string" && /^\d+$/.test(code)) {
    return Number.parseInt(code, 10);
  }
  return null;
}

function extractJinaReaderTargetStatus(
  bodyText: string,
  finalUrl: string
): number | null {
  let parsed: URL;
  try {
    parsed = new URL(finalUrl);
  } catch {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== "r.jina.ai") {
    return null;
  }

  const match = bodyText.match(/Warning:\s*Target URL returned error\s+(\d{3})\b/i);
  if (!match?.[1]) {
    return null;
  }

  const status = Number.parseInt(match[1], 10);
  return Number.isFinite(status) ? status : null;
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function limitText(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function dedupeStrings(values: Iterable<string>): string[] {
  return [...new Set(values)];
}
