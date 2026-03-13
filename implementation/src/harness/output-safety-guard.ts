import type { Scope } from "../domain/types.js";
import { listVisibleKnowledgeSelectors } from "../knowledge/visibility.js";
import {
  canonicalizeUrl,
  isAllowedPublicHttpUrl
} from "../playwright/url-policy.js";
import type { SqliteStore } from "../storage/database.js";
import type { HarnessRequest, HarnessResponse } from "./contracts.js";

type LinkedKnowledgeSource = {
  sourceId: string;
  scope: Scope;
  canonicalUrl: string;
};

export type OutputSafetyDecision = "allow" | "retry" | "refuse";

export type OutputSafetyEvaluation = {
  decision: OutputSafetyDecision;
  reason: string | null;
  allowedSources: string[];
  disallowedSources: string[];
  retryInstruction: string | null;
};

export class OutputSafetyGuard {
  constructor(private readonly store: SqliteStore) {}

  evaluate(input: {
    request: HarnessRequest;
    response: HarnessResponse;
    linkedKnowledgeSources: LinkedKnowledgeSource[];
    observedPublicUrls?: string[];
    retryCount?: number;
  }): OutputSafetyEvaluation {
    const retryCount = input.retryCount ?? 0;
    const allowedSources = new Set<string>();
    const disallowedSources = new Set<string>();
    const violations: string[] = [];
    const visibleSelectors = listVisibleKnowledgeSelectors({
      guildId: input.request.place.guild_id,
      rootChannelId: input.request.place.root_channel_id,
      placeId: input.request.place.thread_id ?? input.request.place.channel_id,
      scope: input.request.place.scope
    });
    const blockedCanonicalUrls = new Set(
      input.request.available_context.blocked_urls.map((url) => safeCanonicalizeUrl(url))
    );
    const explicitlyFetchableUrls = new Set(
      input.request.available_context.fetchable_public_urls.map((url) =>
        safeCanonicalizeUrl(url)
      )
    );
    const observedPublicUrls = new Set(
      (input.observedPublicUrls ?? []).map((url) => safeCanonicalizeUrl(url))
    );
    const linkedSourceIds = new Set(input.linkedKnowledgeSources.map((source) => source.sourceId));

    for (const sourceId of input.response.selected_source_ids) {
      const record = this.store.knowledgeRecords.get(sourceId);
      if (!record) {
        continue;
      }
      if (isRecordVisible(record.scope, record.visibility_key, visibleSelectors) ||
          linkedSourceIds.has(sourceId)) {
        allowedSources.add(sourceId);
        allowedSources.add(record.record_id);
      }
    }

    for (const linkedSource of input.linkedKnowledgeSources) {
      allowedSources.add(linkedSource.sourceId);
    }

    for (const source of input.response.sources_used) {
      const classification = classifySource(source);
      if (classification.kind === "url") {
        const canonicalUrl = classification.canonicalUrl;
        if (
          blockedCanonicalUrls.has(canonicalUrl) ||
          !isAllowedPublicHttpUrl(classification.rawUrl)
        ) {
          disallowedSources.add(source);
          violations.push("blocked or non-public source url");
          continue;
        }

        if (
          explicitlyFetchableUrls.has(canonicalUrl) ||
          observedPublicUrls.has(canonicalUrl)
        ) {
          allowedSources.add(source);
          allowedSources.add(canonicalUrl);
          continue;
        }

        disallowedSources.add(source);
        violations.push("source url is not visible in current scope");
        continue;
      }

      if (classification.kind === "record_id") {
        const record = this.store.knowledgeRecords.get(classification.recordId);
        if (!record) {
          disallowedSources.add(source);
          violations.push("unknown knowledge source id");
          continue;
        }
        if (isRecordVisible(record.scope, record.visibility_key, visibleSelectors) ||
            linkedSourceIds.has(record.record_id)) {
          allowedSources.add(source);
          allowedSources.add(record.record_id);
          continue;
        }

        disallowedSources.add(source);
        violations.push("knowledge source id is outside current scope");
        continue;
      }

      disallowedSources.add(source);
      violations.push(
        classification.kind === "non_public_url"
          ? "blocked or non-public source url"
          : "unrecognized source marker"
      );
    }

    if (violations.length === 0) {
      return {
        decision: "allow",
        reason: null,
        allowedSources: sortStrings(allowedSources),
        disallowedSources: [],
        retryInstruction: null
      };
    }

    const reason = dedupeStrings(violations).join("; ");
    const retryInstruction =
      "scope 外 source や blocked/private URL を根拠に使わず、公開可能な根拠だけで答え直してください。安全な根拠が不足する場合は、その旨を短く明示してください。";

    if (retryCount > 0) {
      return {
        decision: "refuse",
        reason,
        allowedSources: sortStrings(allowedSources),
        disallowedSources: sortStrings(disallowedSources),
        retryInstruction
      };
    }

    return {
      decision: "retry",
      reason,
      allowedSources: sortStrings(allowedSources),
      disallowedSources: sortStrings(disallowedSources),
      retryInstruction
    };
  }

}

function isRecordVisible(
  scope: Scope,
  visibilityKey: string,
  visibleSelectors: ReturnType<typeof listVisibleKnowledgeSelectors>
): boolean {
  return (
    visibleSelectors.scopes.includes(scope) &&
    visibleSelectors.visibilityKeys.includes(visibilityKey)
  );
}

function classifySource(
  source: string
):
  | { kind: "url"; rawUrl: string; canonicalUrl: string }
  | { kind: "record_id"; recordId: string }
  | { kind: "non_public_url" }
  | { kind: "opaque" } {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(source) && !/^https?:\/\//i.test(source)) {
    return { kind: "non_public_url" };
  }

  if (!/^https?:\/\//i.test(source)) {
    return /^[A-Za-z0-9_-]+$/.test(source)
      ? { kind: "record_id", recordId: source }
      : { kind: "opaque" };
  }

  try {
    return {
      kind: "url",
      rawUrl: source,
      canonicalUrl: safeCanonicalizeUrl(source)
    };
  } catch {
    return { kind: "opaque" };
  }
}

function safeCanonicalizeUrl(url: string): string {
  try {
    return canonicalizeUrl(url);
  } catch {
    return url;
  }
}

function dedupeStrings(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}
