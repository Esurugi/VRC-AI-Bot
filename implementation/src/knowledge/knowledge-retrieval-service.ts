import type { Scope } from "../domain/types.js";
import { canonicalizeUrl } from "../playwright/url-policy.js";
import type { SqliteStore, KnowledgeArtifactRow } from "../storage/database.js";
import {
  listVisibleKnowledgeSelectors,
  type KnowledgeVisibilityContext
} from "./visibility.js";

export type HydratedKnowledgeSource = {
  sourceId: string;
  title: string;
  summary: string;
  tags: string[];
  scope: Scope;
  recency: string;
  canonicalUrl: string;
  normalizedText: string | null;
  sourceKind: string | null;
  artifact: KnowledgeArtifactRow | null;
};

export class KnowledgeRetrievalService {
  constructor(private readonly store: SqliteStore) {}

  searchVisibleCandidates(input: {
    query: string;
    context: KnowledgeVisibilityContext;
    limit?: number;
  }) {
    const query = input.query.trim();
    if (query.length === 0) {
      return [];
    }

    const selectors = listVisibleKnowledgeSelectors(input.context);
    const exactCanonicalUrl = tryCanonicalizeUrl(query);
    const textMatchQuery = buildFtsQuery(query);
    const limit = input.limit ?? 30;
    const results = new Map<string, ReturnType<
      SqliteStore["knowledgeRecords"]["findVisibleByCanonicalUrl"]
    >[number]>();

    if (exactCanonicalUrl) {
      for (const candidate of this.store.knowledgeRecords.findVisibleByCanonicalUrl(
        exactCanonicalUrl,
        selectors.scopes,
        selectors.visibilityKeys
      )) {
        results.set(candidate.sourceId, candidate);
      }

      return Array.from(results.values()).slice(0, limit);
    }

    if (textMatchQuery) {
      for (const candidate of this.store.knowledgeRecords.searchVisibleByTerms({
        matchQuery: textMatchQuery,
        allowedScopes: selectors.scopes,
        allowedVisibilityKeys: selectors.visibilityKeys,
        limit
      })) {
        if (!results.has(candidate.sourceId)) {
          results.set(candidate.sourceId, candidate);
        }
      }
    }

    return Array.from(results.values()).slice(0, limit);
  }

  hydrateSources(input: {
    sourceIds: string[];
    context: KnowledgeVisibilityContext;
  }): HydratedKnowledgeSource[] {
    const selectors = listVisibleKnowledgeSelectors(input.context);
    const allowedScopeSet = new Set(selectors.scopes);
    const allowedVisibilityKeySet = new Set(selectors.visibilityKeys);
    const seen = new Set<string>();
    const hydrated: HydratedKnowledgeSource[] = [];

    for (const sourceId of input.sourceIds) {
      if (seen.has(sourceId)) {
        continue;
      }
      seen.add(sourceId);

      const record = this.store.knowledgeRecords.get(sourceId);
      if (!record) {
        continue;
      }
      if (!allowedScopeSet.has(record.scope)) {
        continue;
      }
      if (!allowedVisibilityKeySet.has(record.visibility_key)) {
        continue;
      }

      const sourceText = this.store.knowledgeSourceTexts.get(sourceId);
      hydrated.push({
        sourceId: record.record_id,
        title: record.title,
        summary: record.summary,
        tags: JSON.parse(record.tags_json) as string[],
        scope: record.scope,
        recency: record.created_at,
        canonicalUrl: record.canonical_url,
        normalizedText: sourceText?.normalized_text ?? null,
        sourceKind: sourceText?.source_kind ?? null,
        artifact: this.store.knowledgeArtifacts.get(sourceId)
      });
    }

    return hydrated;
  }
}

function buildFtsQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  if (tokens.length === 0) {
    return null;
  }

  return Array.from(new Set(tokens))
    .map((token) => `"${escapeFtsToken(token)}"`)
    .join(" OR ");
}

function escapeFtsToken(token: string): string {
  return token.replace(/"/g, '""');
}

function tryCanonicalizeUrl(query: string): string | null {
  try {
    return canonicalizeUrl(query);
  } catch {
    return null;
  }
}
