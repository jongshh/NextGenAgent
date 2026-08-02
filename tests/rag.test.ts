import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateGroundingConfidence,
  mergeSemanticEvidence,
  searchLocalEvidence,
  type RagChunk
} from "../packages/rag/src/index";

const baseChunk: RagChunk = {
  id: "person-a-p01-01",
  personId: "person-a",
  personName: "인물 A",
  agentIds: ["pathfinder"],
  sectionTitle: "선택/전환점",
  lifeStage: "turning_point",
  themeTags: ["선택", "진로 전환"],
  sourceFile: "source.pdf",
  pageRange: [1, 1],
  quoteLevel: "summary",
  confidence: "medium",
  reviewStatus: "needs_review",
  sourceTitle: "검수용 자료",
  content: "안정적인 직장을 떠나 새로운 분야를 탐색하며 작은 실험을 반복했다."
};

test("excluded chunks never appear in local retrieval", () => {
  const results = searchLocalEvidence(
    [
      baseChunk,
      {
        ...baseChunk,
        id: "excluded",
        reviewStatus: "excluded",
        content: "선택 진로 전환 실패 극복"
      }
    ],
    "진로를 바꿔도 될까",
    ["선택", "진로 전환"],
    5
  );

  assert.equal(results.some((item) => item.chunk.id === "excluded"), false);
});

test("semantic matches boost the corresponding local citation", () => {
  const otherChunk: RagChunk = {
    ...baseChunk,
    id: "person-b-p02-01",
    personId: "person-b",
    personName: "인물 B",
    content: "조직의 동료와 신뢰를 쌓으며 장기적인 기술 개발에 집중했다."
  };
  const local = searchLocalEvidence([baseChunk, otherChunk], "기술과 동료", ["선택"], 5);
  const merged = mergeSemanticEvidence(
    [baseChunk, otherChunk],
    local,
    [{ text: "안정적인 직장을 떠나 새로운 분야에서 작은 실험을 반복했다.", score: 0.91 }],
    5
  );

  assert.equal(merged[0]?.chunk.id, baseChunk.id);
  assert.equal(merged[0]?.matchedTerms.includes("semantic"), true);
});

test("unreviewed evidence cannot produce high grounding confidence", () => {
  const evidence = [
    { chunk: baseChunk, score: 12, matchedTerms: ["선택"] },
    { chunk: { ...baseChunk, id: "second" }, score: 11, matchedTerms: ["진로"] },
    { chunk: { ...baseChunk, id: "third" }, score: 10, matchedTerms: ["전환"] }
  ];

  assert.equal(estimateGroundingConfidence(evidence), "medium");
});
