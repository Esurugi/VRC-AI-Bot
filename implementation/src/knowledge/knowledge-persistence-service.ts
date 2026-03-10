import { createHash, randomUUID } from "node:crypto";

import type { Logger } from "pino";

import type { Scope } from "../domain/types.js";
import type { HarnessResponse } from "../harness/contracts.js";
import { canonicalizeUrl, extractDomain } from "../playwright/url-policy.js";
import type { SqliteStore } from "../storage/database.js";

type UrlInput = {
  sourceUrl: string;
  index: number;
};

type PersistItem = HarnessResponse["persist_items"][number];

export class KnowledgePersistenceService {
  constructor(
    private readonly store: SqliteStore,
    private readonly logger: Logger
  ) {}

  persist(input: {
    response: HarnessResponse;
    sourceUrls: string[];
    scope: Scope;
    sourceMessageId: string;
    replyThreadId: string;
  }): void {
    const urlInputs = input.sourceUrls.map((sourceUrl, index) => ({
      sourceUrl,
      index
    }));

    for (const urlInput of urlInputs) {
      const item = resolvePersistItem({
        urlInput,
        response: input.response,
        logger: this.logger
      });
      const canonicalUrl = canonicalizeUrl(
        item.canonical_url ?? item.source_url ?? urlInput.sourceUrl
      );
      const summary = item.summary ?? inferSummary(input.response.public_text, canonicalUrl);
      const contentHash =
        item.content_hash ?? synthesizeContentHash(canonicalUrl, summary);
      const existing = this.store.knowledgeRecords.findByDedup(
        canonicalUrl,
        contentHash,
        input.scope
      );

      const recordId = existing?.record_id ?? randomUUID();
      if (!existing) {
        this.store.knowledgeRecords.insert({
          recordId,
          canonicalUrl,
          domain: extractDomain(canonicalUrl),
          title: item.title ?? inferTitle(canonicalUrl),
          summary,
          tags: item.tags,
          scope: input.scope,
          contentHash,
          createdAt: new Date().toISOString()
        });
        this.store.knowledgeArtifacts.upsert({
          recordId,
          finalUrl: canonicalUrl,
          snapshotPath: "codex://web-search",
          screenshotPath: null,
          networkLogPath: null
        });
      }

      this.store.sourceLinks.insert({
        linkId: randomUUID(),
        recordId,
        sourceMessageId: input.sourceMessageId,
        replyThreadId: input.replyThreadId,
        createdAt: new Date().toISOString()
      });
    }
  }
}

function resolvePersistItem(input: {
  urlInput: UrlInput;
  response: HarnessResponse;
  logger: Logger;
}): PersistItem {
  const { urlInput, response, logger } = input;
  const normalizedSourceUrl = canonicalizeUrl(urlInput.sourceUrl);
  const exact = response.persist_items.find((item) => {
    const itemSourceUrl =
      item.source_url === null ? null : canonicalizeUrl(item.source_url);
    const itemCanonicalUrl =
      item.canonical_url === null ? null : canonicalizeUrl(item.canonical_url);
    return (
      itemSourceUrl === normalizedSourceUrl ||
      itemCanonicalUrl === normalizedSourceUrl
    );
  });
  if (exact) {
    return exact;
  }

  const indexed = response.persist_items[urlInput.index];
  if (indexed) {
    logger.warn(
      {
        sourceUrl: urlInput.sourceUrl,
        persistIndex: urlInput.index
      },
      "persist item URL mismatch; using index-based fallback"
    );
    return indexed;
  }

  if (response.persist_items.length === 1) {
    const singleItem = response.persist_items[0];
    if (!singleItem) {
      throw new Error("unreachable: single persist item expected");
    }
    logger.warn(
      {
        sourceUrl: urlInput.sourceUrl
      },
      "persist item URL mismatch; using single-item fallback"
    );
    return singleItem;
  }

  logger.warn(
    {
      sourceUrl: urlInput.sourceUrl
    },
    "persist item missing; synthesizing fallback knowledge from source URL"
  );
  return {
    source_url: urlInput.sourceUrl,
    canonical_url: canonicalizeUrl(urlInput.sourceUrl),
    title: inferTitle(urlInput.sourceUrl),
    summary: inferSummary(response.public_text, urlInput.sourceUrl),
    tags: [],
    content_hash: synthesizeContentHash(
      canonicalizeUrl(urlInput.sourceUrl),
      inferSummary(response.public_text, urlInput.sourceUrl)
    )
  };
}

function inferTitle(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

function inferSummary(publicText: string | null, fallbackUrl: string): string {
  const source = publicText?.trim() || fallbackUrl;
  const normalized = source.replace(/\s+/g, " ").trim();
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 500)}...`;
}

function synthesizeContentHash(canonicalUrl: string, summary: string): string {
  return `sha256:${createHash("sha256").update(`${canonicalUrl}\n${summary}`).digest("hex")}`;
}
