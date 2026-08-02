import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { RagChunk } from "../packages/rag/src/index";

const chunks = JSON.parse(
  readFileSync(new URL("../data/processed/dream-mentor.chunks.json", import.meta.url), "utf8")
) as RagChunk[];

test("dream mentor database contains four isolated agent collections", () => {
  const expected = {
    pathfinder: 40,
    creator: 69,
    thinker: 41,
    connector: 44
  };

  for (const [agentId, count] of Object.entries(expected)) {
    assert.equal(chunks.filter((chunk) => chunk.agentIds[0] === agentId).length, count);
  }
  assert.equal(chunks.every((chunk) => chunk.agentIds.length === 1), true);
});

test("dream mentor database preserves 20 people and unique evidence ids", () => {
  assert.equal(new Set(chunks.map((chunk) => chunk.personId)).size, 20);
  assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, chunks.length);
  assert.equal(chunks.every((chunk) => chunk.pageRange[0] >= 1 && chunk.pageRange[1] <= 141), true);
});
