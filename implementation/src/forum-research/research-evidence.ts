import type { PublicSourceFact, PublicSourceFailure } from "../harness/contracts.js";
import type { ForumResearchSourceCatalogEntry, ForumResearchWorkerPacket } from "./types.js";
import { canonicalizeUrl, isAllowedPublicHttpUrl } from "../playwright/url-policy.js";

/** One incoming research request. Only host acquisition callbacks write facts. */
export class ResearchRunEvidence {
  private readonly factsById = new Map<string, PublicSourceFact>();
  private readonly failuresById = new Map<string, PublicSourceFailure>();

  constructor(facts: PublicSourceFact[] = [], failures: PublicSourceFailure[] = []) {
    this.record({ facts, failures });
  }

  record(result: { facts: PublicSourceFact[]; failures: PublicSourceFailure[] }): void {
    for (const fact of result.facts) this.factsById.set(fact.fact_id, fact);
    for (const failure of result.failures) this.failuresById.set(failure.failure_id, failure);
  }

  get facts(): PublicSourceFact[] { return [...this.factsById.values()]; }
  get failures(): PublicSourceFailure[] { return [...this.failuresById.values()]; }

  resolve(ids: string[]): PublicSourceFact[] {
    return ids.map(id => {
      const fact = this.factsById.get(id);
      if (!fact?.text.trim()) throw new Error(`Evidence fact does not belong to this research run: ${id}`);
      return fact;
    });
  }

  groundPacket(packet: ForumResearchWorkerPacket): ForumResearchWorkerPacket {
    return {
      ...packet,
      evidence_items: packet.evidence_items.map(item => ({
        ...item,
        source_urls: [...new Set(this.resolve(item.evidence_fact_ids).map(fact => canonicalizeUrl(fact.canonical_item_url)))]
      }))
    };
  }

  catalog(packets: ForumResearchWorkerPacket[] = []): ForumResearchSourceCatalogEntry[] {
    const byUrl = new Map<string, ForumResearchSourceCatalogEntry>();
    for (const fact of this.factsById.values()) {
      if (!fact.text.trim() || !isAllowedPublicHttpUrl(fact.canonical_item_url)) continue;
      const url = canonicalizeUrl(fact.canonical_item_url);
      let entry = byUrl.get(url);
      if (!entry) {
        entry = { index: byUrl.size + 1, source_id: fact.fact_id, url, claims: [], evidence_fact_ids: [] };
        byUrl.set(url, entry);
      }
      entry.evidence_fact_ids.push(fact.fact_id);
    }
    for (const packet of packets) {
      for (const item of packet.evidence_items) {
        for (const fact of this.resolve(item.evidence_fact_ids)) {
          const entry = byUrl.get(canonicalizeUrl(fact.canonical_item_url));
          if (entry && !entry.claims.includes(item.claim)) entry.claims.push(item.claim);
        }
      }
    }
    return [...byUrl.values()];
  }
}
