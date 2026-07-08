export type QuoteLevel = "direct_quote" | "paraphrase" | "summary";

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
      const score = tagScore + titleScore + contentScore + quoteBoost;

      return { chunk, score, matchedTerms };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function estimateGroundingConfidence(evidence: RetrievedEvidence[]): "high" | "medium" | "low" {
  if (evidence.length >= 3 && evidence[0]?.score >= 8) return "high";
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
