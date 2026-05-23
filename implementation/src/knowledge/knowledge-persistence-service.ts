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
  item: KnowledgeWrite;
  canonicalUrl: string;
};

type KnowledgeWrite = HarnessResponse["knowledge_writes"][number];
type SkippedKnowledgeWrite = {
  sourceUrl: string | null;
  canonicalUrl: string | null;
  reason: string;
};

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
    approvedEvidenceUrls: string[];
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
      approvedEvidenceUrls: input.approvedEvidenceUrls,
      knowledgeWrites: getKnowledgeWrites(input.response)
    });

    const { persistInputs, skipped } = buildPersistInputs({
      response: input.response,
      approvedEvidenceUrls: input.approvedEvidenceUrls
    });
    if (skipped.length > 0) {
      this.logger.debug(
        {
          sourceMessageId: input.sourceMessageId,
          skipped
        },
        "knowledge persistence skipped incomplete or unapproved knowledge writes"
      );
      appendRuntimeTrace("knowledge-persistence", "knowledge_persist_skipped", {
        sourceMessageId: input.sourceMessageId,
        replyThreadId: input.replyThreadId,
        skipped
      });
    }

    if (persistInputs.length === 0) {
      return;
    }

    for (const urlInput of persistInputs) {
      const item = urlInput.item;
      const capturedAt = new Date().toISOString();
      const canonicalUrl = urlInput.canonicalUrl;
      const title = item.title?.trim();
      const summary = item.summary?.trim();
      if (!title || !summary) {
        continue;
      }
      const normalizedText = inferNormalizedText(item.normalized_text, summary);
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
          title,
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
  approvedEvidenceUrls: string[];
}): {
  persistInputs: UrlInput[];
  skipped: SkippedKnowledgeWrite[];
} {
  const seen = new Set<string>();
  const approvedEvidenceUrls = new Set(
    input.approvedEvidenceUrls
      .filter((url) => isAllowedPublicHttpUrl(url))
      .map((url) => canonicalizeUrl(url))
  );
  const persistInputs: UrlInput[] = [];
  const skipped: SkippedKnowledgeWrite[] = [];
  const knowledgeWrites = getKnowledgeWrites(input.response);

  for (const item of knowledgeWrites) {
    const urls = [item.source_url, item.canonical_url].filter(
      (url): url is string => url !== null
    );
    if (urls.length === 0) {
      skipped.push(toSkippedKnowledgeWrite(item, "missing source url"));
      continue;
    }

    if (urls.some((url) => !isAllowedPublicHttpUrl(url))) {
      skipped.push(toSkippedKnowledgeWrite(item, "blocked or non-public source url"));
      continue;
    }

    const canonicalUrls = urls.map((url) => canonicalizeUrl(url));
    if (canonicalUrls.some((url) => !approvedEvidenceUrls.has(url))) {
      skipped.push(
        toSkippedKnowledgeWrite(
          item,
          "source url is not approved same-turn evidence"
        )
      );
      continue;
    }

    if (!item.title?.trim()) {
      skipped.push(toSkippedKnowledgeWrite(item, "missing title"));
      continue;
    }

    if (!item.summary?.trim()) {
      skipped.push(toSkippedKnowledgeWrite(item, "missing summary"));
      continue;
    }

    const fallbackUrl = item.canonical_url ?? item.source_url ?? urls[0];
    if (!fallbackUrl) {
      skipped.push(toSkippedKnowledgeWrite(item, "missing source url"));
      continue;
    }
    const canonicalUrl = canonicalizeUrl(fallbackUrl);
    if (seen.has(canonicalUrl)) {
      continue;
    }

    seen.add(canonicalUrl);
    persistInputs.push({
      item,
      canonicalUrl
    });
  }

  return {
    persistInputs,
    skipped
  };
}

function toSkippedKnowledgeWrite(
  item: KnowledgeWrite,
  reason: string
): SkippedKnowledgeWrite {
  return {
    sourceUrl: item.source_url,
    canonicalUrl: item.canonical_url,
    reason
  };
}

function inferNormalizedText(publicText: string | null, summary: string): string {
  const source = publicText?.trim() || summary;
  return source.replace(/\s+/g, " ").trim();
}

function synthesizeContentHash(canonicalUrl: string, summary: string): string {
  return `sha256:${createHash("sha256").update(`${canonicalUrl}\n${summary}`).digest("hex")}`;
}
