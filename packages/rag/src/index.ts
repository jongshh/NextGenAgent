export type QuoteLevel = "direct_quote" | "paraphrase" | "summary";
export type ReviewStatus = "verified" | "needs_review" | "excluded";

export interface RagChunk {
  id: string;
  personId: string;
  personName: string;
  agentIds: string[];
  sectionTitle: string;
  lifeStage: string;
  themeTags: string[];
  sourceFile: string;
  pageRange: [number, number];
  quoteLevel: QuoteLevel;
  confidence: "high" | "medium" | "low";
  reviewStatus: ReviewStatus;
  sourceTitle?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  content: string;
}

export interface RetrievedEvidence {
  chunk: RagChunk;
  score: number;
  matchedTerms: string[];
}

const TAG_WEIGHT = 3;
const CONTENT_WEIGHT = 1;
const TITLE_WEIGHT = 2;

export function searchLocalEvidence(
  chunks: RagChunk[],
  query: string,
  preferredTags: string[],
  limit = 4
): RetrievedEvidence[] {
  const terms = tokenize(`${query} ${preferredTags.join(" ")}`);
  const preferredTagSet = new Set(preferredTags);

  return chunks
    .filter((chunk) => chunk.reviewStatus !== "excluded")
    .map((chunk) => {
      const contentTokens = new Set(tokenize(chunk.content));
      const titleTokens = new Set(tokenize(chunk.sectionTitle));
      const matchedTerms = terms.filter(
        (term) => contentTokens.has(term) || titleTokens.has(term) || chunk.themeTags.includes(term)
      );

      const tagScore = chunk.themeTags.filter((tag) => preferredTagSet.has(tag)).length * TAG_WEIGHT;
      const titleScore = terms.filter((term) => titleTokens.has(term)).length * TITLE_WEIGHT;
      const contentScore = terms.filter((term) => contentTokens.has(term)).length * CONTENT_WEIGHT;
      const quoteBoost = chunk.quoteLevel === "direct_quote" ? 1.5 : chunk.quoteLevel === "paraphrase" ? 1 : 0.5;
      const confidenceBoost = chunk.confidence === "high" ? 1 : chunk.confidence === "medium" ? 0.5 : 0;
      const reviewBoost = chunk.reviewStatus === "verified" ? 1.5 : 0;
      const score = tagScore + titleScore + contentScore + quoteBoost + confidenceBoost + reviewBoost;

      return { chunk, score, matchedTerms };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function mergeSemanticEvidence(
  chunks: RagChunk[],
  localEvidence: RetrievedEvidence[],
  semanticMatches: Array<{ text: string; score: number }>,
  limit = 5
): RetrievedEvidence[] {
  const merged = new Map(localEvidence.map((item) => [item.chunk.id, { ...item }]));

  for (const semanticMatch of semanticMatches) {
    const semanticTokens = new Set(tokenize(semanticMatch.text));
    if (semanticTokens.size === 0) continue;

    let bestChunk: RagChunk | null = null;
    let bestOverlap = 0;

    for (const chunk of chunks) {
      if (chunk.reviewStatus === "excluded") continue;
      const chunkTokens = new Set(tokenize(chunk.content));
      let overlap = 0;
      for (const token of semanticTokens) {
        if (chunkTokens.has(token)) overlap += 1;
      }

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestChunk = chunk;
      }
    }

    if (!bestChunk || bestOverlap < 4) continue;
    const existing = merged.get(bestChunk.id);
    const semanticBoost = Math.max(0, semanticMatch.score) * 8 + Math.min(bestOverlap, 8) * 0.4;
    merged.set(bestChunk.id, {
      chunk: bestChunk,
      score: (existing?.score || 0) + semanticBoost,
      matchedTerms: Array.from(new Set([...(existing?.matchedTerms || []), "semantic"]))
    });
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function estimateGroundingConfidence(evidence: RetrievedEvidence[]): "high" | "medium" | "low" {
  const verifiedEvidence = evidence.filter((item) => item.chunk.reviewStatus === "verified");
  if (verifiedEvidence.length >= 2 && verifiedEvidence[0]?.score >= 8) return "high";
  if (evidence.length >= 2 && evidence[0]?.score >= 5) return "medium";
  return "low";
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/]/gu, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}
