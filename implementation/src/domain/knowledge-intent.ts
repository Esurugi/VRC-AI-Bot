const KNOWLEDGE_SAVE_PATTERNS = [
  /知見(?:として|に)?(?:残|保存|追加|登録|蓄積)/u,
  /(?:残|保存|追加|登録|蓄積).{0,12}知見/u,
  /ナレッジ(?:として|に)?(?:残|保存|追加|登録|蓄積)/u,
  /(?:残|保存|追加|登録|蓄積).{0,12}ナレッジ/u,
  /共有知見(?:として|に)?(?:残|保存|追加|登録|蓄積)/u,
  /(?:残|保存|追加|登録|蓄積).{0,12}共有知見/u,
  /DB(?:に|へ)?(?:残|保存|追加|登録|入)/iu,
  /(?:save|store|record|persist).{0,20}(?:knowledge|memory|db)/iu,
  /(?:knowledge|memory|db).{0,20}(?:save|store|record|persist)/iu
] as const;

const KNOWLEDGE_SEARCH_STOP_TERMS = new Set([
  "リンク",
  "url",
  "知見",
  "共有知見",
  "ナレッジ"
]);

export function isExplicitKnowledgeSaveRequest(content: string): boolean {
  const normalized = content.trim();
  if (normalized.length === 0) {
    return false;
  }

  return KNOWLEDGE_SAVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function buildKnowledgeSearchQuery(input: {
  content: string;
  urls: string[];
}): string {
  const normalizedContent = input.content.trim();
  if (normalizedContent.length === 0) {
    return input.urls.join("\n").trim();
  }

  const searchTerms = Array.from(
    new Set([
      ...extractQuotedPhrases(normalizedContent),
      ...extractKatakanaTerms(normalizedContent),
      ...extractAsciiTerms(normalizedContent)
    ])
  );

  if (searchTerms.length > 0) {
    return searchTerms.join(" ");
  }

  return normalizedContent;
}

function extractQuotedPhrases(content: string): string[] {
  return Array.from(
    content.matchAll(/["'「『](.{2,60}?)["'」』]/gu),
    (match) => match[1]?.trim() ?? ""
  ).filter((term) => term.length >= 2 && !KNOWLEDGE_SEARCH_STOP_TERMS.has(term));
}

function extractKatakanaTerms(content: string): string[] {
  return Array.from(
    content.matchAll(/[\p{Script=Katakana}ー]{2,}/gu),
    (match) => match[0]?.trim() ?? ""
  ).filter((term) => term.length >= 2 && !KNOWLEDGE_SEARCH_STOP_TERMS.has(term));
}

function extractAsciiTerms(content: string): string[] {
  return Array.from(
    content.matchAll(/[A-Za-z][A-Za-z0-9_-]{1,}/g),
    (match) => match[0]?.trim().toLowerCase() ?? ""
  ).filter((term) => term.length >= 2 && !KNOWLEDGE_SEARCH_STOP_TERMS.has(term));
}
