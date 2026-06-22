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
  contentType: string | null;
  title: string | null;
  text: string | null;
  fxTwitterCode?: number | null;
};

const MAX_BODY_READ_CHARS = 64_000;
const MAX_EXTRACTED_TEXT_CHARS = 8_000;

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
  const contentType = response.headers.get("content-type");
  const bodyText = await readResponseText(response, MAX_BODY_READ_CHARS);
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
      text: limitText(normalizeWhitespace(stripHtml(bodyText)))
    };
  }

  return {
    title: null,
    text: null
  };
}

async function readResponseText(
  response: Response,
  maxChars: number
): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";

  try {
    while (output.length < maxChars) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
    output += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }

  return output.slice(0, maxChars);
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
    if (depth > 4 || lines.join("\n").length >= MAX_EXTRACTED_TEXT_CHARS) {
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
      for (const item of value.slice(0, 20)) {
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
    lines: dedupeStrings(lines).slice(0, 20)
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
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
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
  return normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS);
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
