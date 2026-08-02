import assert from "node:assert/strict";
import test from "node:test";
import {
  neutralizeUnverifiedExperience,
  parseModelScene,
  sanitizeChoices
} from "../apps/worker/src/index";
import type { RetrievedEvidence, RagChunk } from "../packages/rag/src/index";

const chunk: RagChunk = {
  id: "evidence-1",
  personId: "person-a",
  personName: "인물 A",
  agentIds: ["pathfinder"],
  sectionTitle: "선택/전환점",
  lifeStage: "turning_point",
  themeTags: ["선택"],
  sourceFile: "source.pdf",
  pageRange: [1, 1],
  quoteLevel: "paraphrase",
  confidence: "medium",
  reviewStatus: "needs_review",
  content: "낯선 분야로 옮기기 전에 작은 프로젝트로 가능성을 시험했다."
};

const evidence: RetrievedEvidence[] = [{ chunk, score: 7, matchedTerms: ["선택"] }];

test("structured scene accepts only retrieved evidence ids", () => {
  const parsed = parseModelScene(
    JSON.stringify({
      text: "나도 방향을 바꾸기 전에는 작은 실험부터 해봤어요.",
      mood: "reflective",
      portraitVariant: "encouraging",
      choices: ["내가 시험해볼 일을 말해볼게요.", "두려운 점부터 살펴볼래요.", "이번 주 작은 행동을 정해볼게요."],
      evidenceIds: ["evidence-1", "invented-id"]
    }),
    "길을 찾는 사람",
    evidence
  );

  assert.ok(parsed);
  assert.deepEqual(parsed.evidenceIds, ["evidence-1"]);
  assert.equal(parsed.choices.length, 3);
});

test("duplicate or malformed choices fall back to a safe set", () => {
  const choices = sanitizeChoices(["같은 말", "같은 말", ""]);
  assert.equal(choices.length, 3);
  assert.equal(new Set(choices).size, 3);
});

test("retrieved life patterns can be spoken as the composite mentor's experience", () => {
  const guarded = neutralizeUnverifiedExperience(
    "나도 그 무렵 작은 실험부터 시작했어요. 내 경험에서는 서두르지 않는 게 중요했죠.",
    evidence
  );

  assert.equal(guarded.includes("나도"), true);
  assert.equal(guarded.includes("내 경험"), true);
  assert.equal(guarded.includes("기록"), false);
});
