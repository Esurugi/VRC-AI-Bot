import { createHash, randomUUID } from "node:crypto";

import type { Logger } from "pino";

import type { Scope } from "../domain/types.js";
import type { HarnessResponse } from "../harness/contracts.js";
import { appendRuntimeTrace } from "../observability/runtime-trace.js";
import {
  canonicalizeUrl,
  extractDomain,
  isAllowedPublicHttpUrl
} from "../playwright/url-policy.js";
import type { SqliteStore } from "../storage/database.js";
import { buildVisibilityKey } from "./visibility.js";

type UrlInput = {
  sourceUrl: string;
  index: number;
  kind: "message_url" | "knowledge_write";
};

type KnowledgeWrite = HarnessResponse["knowledge_writes"][number];

export class KnowledgePersistenceService {
  constructor(
    private readonly store: SqliteStore,
    private readonly logger: Logger
  ) {}

  persist(input: {
    response: HarnessResponse;
    sourceUrls: string[];
    guildId: string;
    rootChannelId: string;
    placeId: string;
    scope: Scope;
    sourceMessageId: string;
    replyThreadId: string | null;
  }): void {
    appendRuntimeTrace("knowledge-persistence", "knowledge_persist_requested", {
      outcome: input.response.outcome,
      sourceMessageId: input.sourceMessageId,
      replyThreadId: input.replyThreadId,
      scope: input.scope,
      guildId: input.guildId,
      rootChannelId: input.rootChannelId,
      placeId: input.placeId,
      sourceUrls: input.sourceUrls,
      knowledgeWrites: getKnowledgeWrites(input.response)
    });

    const urlInputs = buildPersistInputs(input);

    for (const urlInput of urlInputs) {
      const item = resolveKnowledgeWrite({
        urlInput,
        response: input.response,
        logger: this.logger
      });
      const capturedAt = new Date().toISOString();
      const canonicalUrl = canonicalizeUrl(
        item.canonical_url ?? item.source_url ?? urlInput.sourceUrl
      );
      const summary = item.summary ?? inferSummary(input.response.public_text, canonicalUrl);
      const normalizedText = inferNormalizedText(
        publicTextForPersistedSource(item, input.response),
        summary
      );
      const contentHash =
        item.content_hash ?? synthesizeContentHash(canonicalUrl, summary);
      const visibilityKey = buildVisibilityKey({
        guildId: input.guildId,
        rootChannelId: input.rootChannelId,
        placeId: input.placeId,
        scope: input.scope
      });
      const existing = this.store.knowledgeRecords.findByDedup(
        canonicalUrl,
        contentHash,
        input.scope,
        visibilityKey
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
          visibilityKey,
          contentHash,
          createdAt: capturedAt
        });
        this.store.knowledgeArtifacts.upsert({
          recordId,
          finalUrl: canonicalUrl,
          snapshotPath: "codex://web-search",
          screenshotPath: null,
          networkLogPath: null
        });
      }
      this.store.knowledgeSourceTexts.upsert({
        recordId,
        normalizedText,
        sourceKind: item.source_kind ?? "shared_public_text",
        capturedAt
      });

      this.store.sourceLinks.insert({
        linkId: randomUUID(),
        recordId,
        sourceMessageId: input.sourceMessageId,
        replyThreadId: input.replyThreadId,
        createdAt: capturedAt
      });

      appendRuntimeTrace("knowledge-persistence", "knowledge_persisted", {
        sourceMessageId: input.sourceMessageId,
        replyThreadId: input.replyThreadId,
        recordId,
        canonicalUrl,
        visibilityKey,
        scope: input.scope,
        sourceKind: item.source_kind ?? "shared_public_text",
        reusedExistingRecord: existing !== null
      });
    }
  }
}

function getKnowledgeWrites(response: HarnessResponse): KnowledgeWrite[] {
  return response.knowledge_writes;
}

function buildPersistInputs(input: {
  response: HarnessResponse;
  sourceUrls: string[];
}): UrlInput[] {
  const seen = new Set<string>();
  const persistInputs: UrlInput[] = [];
  const knowledgeWrites = getKnowledgeWrites(input.response);

  const pushSource = (
    sourceUrl: string,
    index: number,
    kind: UrlInput["kind"]
  ) => {
    if (!isAllowedPublicHttpUrl(sourceUrl)) {
      return;
    }

    const canonicalUrl = canonicalizeUrl(sourceUrl);
    if (seen.has(canonicalUrl)) {
      return;
    }

    seen.add(canonicalUrl);
    persistInputs.push({
      sourceUrl,
      index,
      kind
    });
  };

  input.sourceUrls.forEach((sourceUrl, index) => {
    pushSource(sourceUrl, index, "message_url");
  });

  knowledgeWrites.forEach((item, index) => {
    const sourceUrl = item.canonical_url ?? item.source_url;
    if (!sourceUrl) {
      return;
    }
    pushSource(sourceUrl, index, "knowledge_write");
  });

  if (persistInputs.length === 0) {
    throw new Error("knowledge_ingest requires at least one persistable public source");
  }

  return persistInputs;
}

function resolveKnowledgeWrite(input: {
  urlInput: UrlInput;
  response: HarnessResponse;
  logger: Logger;
}): KnowledgeWrite {
  const { urlInput, response, logger } = input;
  const knowledgeWrites = getKnowledgeWrites(response);
  const normalizedSourceUrl = canonicalizeUrl(urlInput.sourceUrl);
  const exact = knowledgeWrites.find((item) => {
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

  if (urlInput.kind === "message_url") {
    logger.warn(
      {
        sourceUrl: urlInput.sourceUrl
      },
      "knowledge write URL mismatch for message URL; synthesizing fallback knowledge"
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
      ),
      normalized_text: response.public_text,
      source_kind: "shared_public_text"
    };
  }

  const indexed = knowledgeWrites[urlInput.index];
  if (indexed) {
    logger.warn(
      {
        sourceUrl: urlInput.sourceUrl,
        knowledgeWriteIndex: urlInput.index
      },
      "knowledge write URL mismatch; using index-based fallback"
    );
    return indexed;
  }

  if (knowledgeWrites.length === 1) {
    const singleItem = knowledgeWrites[0];
    if (!singleItem) {
      throw new Error("unreachable: single knowledge write expected");
    }
    logger.warn(
      {
        sourceUrl: urlInput.sourceUrl
      },
      "knowledge write URL mismatch; using single-item fallback"
    );
    return singleItem;
  }

  logger.warn(
    {
      sourceUrl: urlInput.sourceUrl
    },
    "knowledge write missing; synthesizing fallback knowledge from source URL"
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
    ),
    normalized_text: response.public_text,
    source_kind: "shared_public_text"
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

function inferNormalizedText(publicText: string | null, summary: string): string {
  const source = publicText?.trim() || summary;
  return source.replace(/\s+/g, " ").trim();
}

function publicTextForPersistedSource(
  item: KnowledgeWrite,
  response: HarnessResponse
): string | null {
  return item.normalized_text?.trim() || item.summary?.trim() || response.public_text;
}

function synthesizeContentHash(canonicalUrl: string, summary: string): string {
  return `sha256:${createHash("sha256").update(`${canonicalUrl}\n${summary}`).digest("hex")}`;
}
