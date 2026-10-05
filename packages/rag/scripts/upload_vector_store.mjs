import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readVars, updateVars, atomicWrite, isConfigured } from '../../../scripts/config.mjs';

export async function syncVectorStore({ vars, manifest, request, readBytes = path => readFile(path), sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now }) {
  let storeId = vars.OPENAI_VECTOR_STORE_ID;
  if (!isConfigured(storeId)) {
    storeId = (await request('/vector_stores', { method: 'POST', json: { name: 'NextGenAgent four mentors' } })).id;
    await updateVars({ OPENAI_VECTOR_STORE_ID: storeId });
  }
  await request(`/vector_stores/${encodeURIComponent(storeId)}`);
  const attached = [];
  let after;
  do {
    const query = new URLSearchParams({ limit: '100', ...(after ? { after } : {}) });
    const page = await request(`/vector_stores/${storeId}/files?${query}`);
    attached.push(...(page.data || []));
    after = page.has_more ? page.last_id : undefined;
  } while (after);
  const indexed = [];
  let reused = 0;
  for (const source of manifest.sources) {
    const bytes = await readBytes(source.path);
    if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`PDF changed during synchronization: ${source.path}`);
    let attachment = attached.find(file => file.attributes?.source === 'nextgen-mentor-db' &&
      file.attributes?.agent_id === source.agentId && file.attributes?.db_version === manifest.version &&
      file.attributes?.sha256 === source.sha256 && ['completed', 'in_progress'].includes(file.status));
    if (attachment) reused++;
    if (!attachment) {
      const form = new FormData();
      form.set('purpose', 'assistants');
      form.set('file', new Blob([bytes], { type: 'application/pdf' }), basename(source.path));
      const uploaded = await request('/files', { method: 'POST', body: form });
      attachment = await request(`/vector_stores/${storeId}/files`, { method: 'POST', json: {
        file_id: uploaded.id,
        attributes: { source: 'nextgen-mentor-db', agent_id: source.agentId, db_version: manifest.version, sha256: source.sha256, updated_at: new Date(now()).toISOString() }
      } });
    }
    const deadline = now() + 300_000;
    while (attachment.status !== 'completed') {
      if (['failed', 'cancelled'].includes(attachment.status)) throw new Error(`Indexing ${source.agentId}: ${attachment.status}`);
      if (now() >= deadline) throw new Error(`Indexing timed out: ${source.agentId}`);
      await sleep(2000);
      attachment = await request(`/vector_stores/${storeId}/files/${attachment.id}`);
    }
    indexed.push({ agentId: source.agentId, fileId: attachment.id });
  }
  return { storeId, version: manifest.version, files: indexed, reused, uploaded: manifest.sources.length - reused };
}
async function main() {
  const directory = resolve(process.argv[2] || 'data/processed');
  const vars = await readVars();
  if (!isConfigured(vars.OPENAI_API_KEY)) throw new Error('OPENAI_API_KEY 설정이 필요합니다.');
  const manifest = JSON.parse(await readFile(`${directory}/db-manifest.json`, 'utf8'));
  const request = async (endpoint, init = {}) => {
    const response = await fetch(`https://api.openai.com/v1${endpoint}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${vars.OPENAI_API_KEY}`, ...(init.json ? { 'Content-Type': 'application/json' } : {}) },
      body: init.json ? JSON.stringify(init.json) : init.body,
      signal: AbortSignal.timeout(60_000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`OpenAI ${response.status}: API 권한·키·요청을 확인하세요.`);
    return payload;
  };
  const result = await syncVectorStore({ vars, manifest, request });
  const chunks = await readFile(`${directory}/dream-mentor.chunks.json`, 'utf8');
  if (directory !== resolve('data/processed')) {
    await atomicWrite('data/processed/dream-mentor.chunks.json', chunks);
    await atomicWrite('data/processed/db-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    await atomicWrite('data/processed/db-bundle.json', JSON.stringify({ manifest, chunks: JSON.parse(chunks) }, null, 2) + '\n');
  }
  await updateVars({ OPENAI_DB_VERSION: manifest.version });
  await atomicWrite('.local/vector-sync.json', JSON.stringify(result, null, 2));
  console.log(`네 DB의 인덱싱 완료: ${manifest.version} (재사용 ${result.reused}, 업로드 ${result.uploaded})`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
