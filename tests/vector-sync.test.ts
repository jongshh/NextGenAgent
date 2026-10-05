import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { syncVectorStore } from '../packages/rag/scripts/upload_vector_store.mjs';

const bytes = Buffer.from('test-pdf');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = { version: 'new-version', sources: ['pathfinder', 'creator', 'thinker', 'connector'].map(agentId => ({ path: `${agentId}.pdf`, agentId, sha256 })) };
const vars = { OPENAI_VECTOR_STORE_ID: 'vs-test' };
const attachment = (agentId: string, status = 'completed') => ({ id: `file-${agentId}`, status, attributes: { source: 'nextgen-mentor-db', agent_id: agentId, db_version: manifest.version, sha256 } });

test('completed hashes are reused across all four roles without upload or deletion', async () => {
  const calls: string[] = [];
  const result = await syncVectorStore({ vars, manifest, readBytes: async () => bytes, request: async (url: string, init: any = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    return url.includes('/files?') ? { data: manifest.sources.map(source => attachment(source.agentId)), has_more: false } : {};
  } });
  assert.equal(result.files.length, 4);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.startsWith('GET')));
});
test('pending files are polled and failure prevents a complete generation result', async () => {
  let polled = false;
  await assert.rejects(syncVectorStore({ vars, manifest, readBytes: async () => bytes, sleep: async () => {}, request: async (url: string) => {
    if (url.includes('/files?')) return { data: manifest.sources.map(source => attachment(source.agentId, 'in_progress')) };
    if (url.endsWith('/file-pathfinder')) { polled = true; return { status: 'failed' }; }
    return {};
  } }), /Indexing pathfinder: failed/);
  assert.equal(polled, true);
});
test('an inaccessible existing store never creates a replacement', async () => {
  const calls: string[] = [];
  await assert.rejects(syncVectorStore({ vars, manifest, request: async (url: string) => { calls.push(url); throw new Error('403'); } }), /403/);
  assert.deepEqual(calls, ['/vector_stores/vs-test']);
});
test('a source changed after extraction is rejected before upload', async () => {
  const calls: string[] = [];
  await assert.rejects(syncVectorStore({ vars, manifest, readBytes: async () => Buffer.from('changed'), request: async (url: string) => { calls.push(url); return { data: [] }; } }), /PDF changed/);
  assert.equal(calls.length, 2);
});
