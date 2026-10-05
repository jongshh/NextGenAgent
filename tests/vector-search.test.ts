import test from 'node:test';
import assert from 'node:assert/strict';
import { searchVectorStore } from '../apps/worker/src/index';
import bundle from '../data/processed/db-bundle.json';

test('direct and Supabase vector searches carry the active role and immutable local version', async () => {
  const original = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return Response.json({ data: [] }); };
  try {
    await searchVectorStore('도전', 'connector', { OPENAI_API_KEY: 'test-key', OPENAI_VECTOR_STORE_ID: 'vs-test' });
    await searchVectorStore('창작', 'creator', { SUPABASE_FUNCTIONS_URL: 'https://example.supabase.co/functions/v1', NEXTGEN_PROXY_SECRET: 'test-secret' });
    assert.equal(requests[0].body.filters.filters[0].value, 'connector');
    assert.equal(requests[0].body.filters.filters[1].value, bundle.manifest.version);
    assert.equal(requests[1].body.payload.filters.filters[0].value, 'creator');
    assert.equal(requests[1].body.payload.filters.filters[1].value, bundle.manifest.version);
  } finally { globalThis.fetch = original; }
});
