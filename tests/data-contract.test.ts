import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { RagChunk } from "../packages/rag/src/index";
import manifest from '../data/processed/db-manifest.json';
import { createHash } from 'node:crypto';

const chunks = JSON.parse(
  readFileSync(new URL("../data/processed/dream-mentor.chunks.json", import.meta.url), "utf8")
) as RagChunk[];

test("dream mentor database contains four isolated agent collections", () => {
  for (const source of manifest.sources) {
    const collection = chunks.filter(chunk => chunk.agentIds[0] === source.agentId);
    assert.equal(collection.length, source.chunks);
    assert.ok(collection.length > 0);
    assert.ok(collection.every(chunk => chunk.sourceFile === source.path && chunk.pageRange[0] >= 1 && chunk.pageRange[1] <= source.pages));
    assert.equal(createHash('sha256').update(readFileSync(source.path)).digest('hex'), source.sha256);
  }
  assert.equal(chunks.every((chunk) => chunk.agentIds.length === 1), true);
});

test("updated four PDFs preserve 24 people and unique evidence ids", () => {
  assert.equal(new Set(chunks.map((chunk) => chunk.personId)).size, 24);
  assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, chunks.length);
  assert.ok(chunks.some(chunk => chunk.personId === 'roald-amundsen' && chunk.agentIds[0] === 'connector'));
  assert.ok(chunks.some(chunk => chunk.personId === 'baek-hee-na' && chunk.agentIds[0] === 'creator'));
  assert.ok(chunks.some(chunk => chunk.personId === 'diogenes' && chunk.agentIds[0] === 'thinker'));
});
