import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeSettings, normalizeProjectRef } from '../scripts/runtime.mjs';
import { parseVars } from '../scripts/config.mjs';

test('worker runtime receives only runtime secrets, never installation credentials', () => {
  const projected = runtimeSettings({ OPENAI_API_KEY: 'key', SUPABASE_ACCESS_TOKEN: 'management-token', SUPABASE_DB_PASSWORD: 'db-password', SUPABASE_PROJECT_REF: 'project-ref', NEXTGEN_PROXY_SECRET: 'proxy-secret', UNRELATED_SECRET: 'secret' });
  assert.deepEqual(projected, { OPENAI_API_KEY: 'key', NEXTGEN_PROXY_SECRET: 'proxy-secret' });
});
test('dotenv reader handles quotes, CRLF and values containing equals without exposing comments', () => {
  assert.deepEqual(parseVars('# ignored\r\nA="a=b"\r\nB=plain\r\nC=\'value\'\r\nA=last\r\n'), { A: 'last', B: 'plain', C: 'value' });
  assert.deepEqual(parseVars('A=one\rB=two\nC=three\r\n'), { A: 'one', B: 'two', C: 'three' });
});
test('dashboard paths and Supabase URLs normalize to an explicit project ID', () => {
  assert.equal(normalizeProjectRef('/project/wfyghzowxusawsztprqh'), 'wfyghzowxusawsztprqh');
  assert.equal(normalizeProjectRef('https://wfyghzowxusawsztprqh.supabase.co/functions/v1'), 'wfyghzowxusawsztprqh');
  assert.equal(normalizeProjectRef('some-project-name'), 'some-project-name');
});
