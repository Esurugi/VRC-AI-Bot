import type { ForumResearchSourceCatalogEntry } from "./types.js";
import { canonicalizeUrl, isAllowedPublicHttpUrl } from "../playwright/url-policy.js";

/** Resolve internal source references once, before Discord chunks are created. */
export function compileForumCitations(
  text: string,
  catalog: ForumResearchSourceCatalogEntry[]
): { text: string; sourcesUsed: string[] } {
  const sources = new Map<string, string>();
  for (const entry of catalog) {
    if (!isAllowedPublicHttpUrl(entry.url)) continue;
    const url = canonicalizeUrl(entry.url);
    sources.set(entry.source_id, url);
    for (const id of entry.evidence_fact_ids) sources.set(id, url);
  }
  const numbers = new Map<string, number>();
  const sourcesUsed: string[] = [];
  const compiled = text.replace(/\[\[source:([^\]\s]+)\]\]/g, (_marker, id: string) => {
    const url = sources.get(id);
    if (!url) throw new SyntaxError(`Unknown forum citation: ${id}`);
    let number = numbers.get(url);
    if (number === undefined) {
      sourcesUsed.push(url);
      number = sourcesUsed.length;
      numbers.set(url, number);
    }
    return `[${number}]`;
  });
  if (compiled.includes("[[source:")) throw new SyntaxError("Malformed forum citation");
  return { text: compiled, sourcesUsed };
}
