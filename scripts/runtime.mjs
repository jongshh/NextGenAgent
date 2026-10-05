import { readFile, readdir, access, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { atomicWrite, readVars, updateVars, parseVars, isConfigured } from './config.mjs';

export const runtimeKeys = ['OPENAI_API_KEY', 'OPENAI_VECTOR_STORE_ID', 'OPENAI_DB_VERSION', 'OPENAI_MODEL', 'OPENAI_MODERATION_MODEL', 'OPENAI_LIVE_MODEL', 'VOICE_ENABLED', 'VOICE_ADMIN_PASSWORD', 'VOICE_ADMIN_SESSION_SECRET', 'SUPABASE_FUNCTIONS_URL', 'NEXTGEN_PROXY_SECRET'];
export const remoteKeys = ['OPENAI_API_KEY', 'OPENAI_VECTOR_STORE_ID', 'OPENAI_DB_VERSION', 'NEXTGEN_PROXY_SECRET'];
export function runtimeSettings(vars) { return Object.fromEntries(runtimeKeys.filter(key => vars[key]).map(key => [key, vars[key]])); }
export function normalizeProjectRef(value) {
  const trimmed = (value || '').trim();
  if (/^[a-z0-9]{20}$/.test(trimmed)) return trimmed;
  const dashboard = trimmed.match(/(?:^|\/)project\/([a-z0-9]{20})(?:[/?#]|$)/);
  if (dashboard) return dashboard[1];
  try { const host = new URL(trimmed).hostname; return host.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] || trimmed; } catch { return trimmed; }
}
const json = async file => JSON.parse(await readFile(file, 'utf8'));
async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.filter(entry => !['node_modules', 'dist', '.local', '.wrangler', '.temp'].includes(entry.name)).map(entry => {
    const name = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(name) : [name];
  }))).flat();
}
async function fingerprint(files, extra = '') {
  const hash = createHash('sha256').update(extra);
  for (const file of [...files].sort()) hash.update(file).update(await readFile(file));
  return hash.digest('hex');
}
export async function sourceFingerprint() {
  return fingerprint([...(await filesUnder('apps')).filter(file => !file.includes('/.dev.vars')), ...(await filesUnder('packages')), ...(await filesUnder('data/processed')), 'package-lock.json']);
}
export async function prepare() {
  let vars = await readVars().catch(() => ({}));
  const defaults = parseVars(await readFile('apps/worker/.dev.vars.example', 'utf8'));
  const patch = Object.fromEntries(Object.entries(defaults).filter(([key]) => !(key in vars)));
  for (const key of ['NEXTGEN_PROXY_SECRET', 'VOICE_ADMIN_PASSWORD', 'VOICE_ADMIN_SESSION_SECRET']) {
    if (!isConfigured(vars[key] || patch[key])) patch[key] = randomBytes(32).toString('base64url');
  }
  if (Object.keys(patch).length) await updateVars(patch);
  vars = await readVars();
  const normalizedRef = normalizeProjectRef(vars.SUPABASE_PROJECT_REF);
  if (normalizedRef !== vars.SUPABASE_PROJECT_REF) {
    await updateVars({ SUPABASE_PROJECT_REF: normalizedRef });
    vars.SUPABASE_PROJECT_REF = normalizedRef;
    console.log('Supabase 대시보드 경로에서 프로젝트 ID를 추출했습니다.');
  }
  if (/^[a-z0-9]{20}$/.test(vars.SUPABASE_PROJECT_REF || '')) await updateVars({ SUPABASE_FUNCTIONS_URL: `https://${vars.SUPABASE_PROJECT_REF}.supabase.co/functions/v1` });
  const missing = ['OPENAI_API_KEY', 'SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD'].filter(key => !isConfigured(vars[key]));
  if (missing.length) throw new Error(`apps/worker/.dev.vars에 설정이 필요합니다: ${missing.join(', ')}. 값을 입력한 뒤 다시 실행하세요.`);
  if (!/^[a-z0-9]{20}$/.test(vars.SUPABASE_PROJECT_REF)) throw new Error('SUPABASE_PROJECT_REF는 프로젝트 대시보드의 20자 ID여야 합니다.');
  if ((vars.VOICE_ADMIN_PASSWORD || '').length < 12 || (vars.VOICE_ADMIN_SESSION_SECRET || '').length < 32) throw new Error('개발자 암호는 12자, 세션 비밀값은 32자 이상이어야 합니다.');
  console.log('설정 확인 완료. 개발자 암호는 .dev.vars의 VOICE_ADMIN_PASSWORD에서 확인하세요.');
}
export async function writeWorkerConfig(webOnly = false) {
  const vars = await readVars();
  const instance = createHash('sha256').update(resolve('.')).update(await sourceFingerprint()).update(webOnly ? 'web' : 'hue').update(JSON.stringify(runtimeSettings(vars))).digest('hex');
  const root = resolve('.').replaceAll('\\', '/');
  await atomicWrite('.local/worker/.dev.vars', Object.entries(runtimeSettings(vars)).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
  await atomicWrite('.local/worker/wrangler.json', JSON.stringify({
    name: 'nextgenagent-worker', main: `${root}/apps/worker/src/index.ts`, compatibility_date: '2026-09-27', compatibility_flags: ['nodejs_compat'],
    vars: { NEXTGEN_INSTANCE_ID: instance, ALLOWED_ORIGIN: 'http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:5173,http://localhost:5173' },
    assets: { directory: `${root}/apps/web/dist`, binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] }
  }, null, 2));
  await atomicWrite('.local/instance.json', JSON.stringify({ instanceId: instance, webOnly }));
  if (!await json('.local/control.json').catch(() => null)) await atomicWrite('.local/control.json', JSON.stringify({ token: randomBytes(32).toString('base64url') }));
}
export async function sourceVersionMatches() {
  const manifest = await json('data/processed/db-manifest.json').catch(() => null);
  const sources = await json('packages/rag/sources.json');
  if (!manifest || manifest.sources.length !== sources.length) return false;
  const bundle = await json('data/processed/db-bundle.json').catch(() => null);
  if (!bundle || bundle.manifest.version !== manifest.version) return false;
  for (const source of sources) {
    const current = manifest.sources.find(item => item.path === source.path && item.agentId === source.agentId);
    if (!current || current.sha256 !== createHash('sha256').update(await readFile(source.path)).digest('hex')) return false;
  }
  return true;
}
export async function needsSync() {
  if (!await sourceVersionMatches()) return true;
  const vars = await readVars();
  const manifest = await json('data/processed/db-manifest.json');
  const synced = await json('.local/vector-sync.json').catch(() => null);
  return !synced || synced.version !== manifest.version || synced.storeId !== vars.OPENAI_VECTOR_STORE_ID;
}
function redact(raw, values) {
  let text = raw;
  for (const value of values.filter(value => typeof value === 'string' && value.length >= 4)) text = text.split(value).join('[REDACTED]');
  return text;
}
async function cli(args, vars) {
  // Pin the CLI package; credentials are passed only through the child environment.
  const command = process.platform === 'win32' ? process.execPath : 'npx';
  const commandArgs = process.platform === 'win32' ? [resolve(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...commandArgs, '--yes', 'supabase@2.119.0', ...args], {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: vars.SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD: vars.SUPABASE_DB_PASSWORD },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let raw = '';
    child.stdout.on('data', data => { raw += data; }); child.stderr.on('data', data => { raw += data; });
    child.on('error', reject);
    child.on('exit', code => {
      const safe = redact(raw, Object.values(vars));
      if (code !== 0) reject(new Error(`Supabase ${args[0]} 실패:\n${safe}`));
      else resolvePromise(safe);
    });
  });
  if (output.trim()) console.log(output.trim());
}
async function verifySupabase(vars, write = true) {
  const base = `https://${vars.SUPABASE_PROJECT_REF}.supabase.co/functions/v1`;
  const invoke = async (fn, body) => {
    const response = await fetch(`${base}/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nextgen-proxy-secret': vars.NEXTGEN_PROXY_SECRET }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Supabase ${fn} 검증 실패 (${response.status}). 함수 배포·비밀 설정·권한을 확인하세요.`);
    return response.json();
  };
  // Dedicated diagnostic participant ID, never an existing participant record.
  const participantId = `diag-${vars.SUPABASE_PROJECT_REF}`;
  if (write) await invoke('session-api', { action: 'save', participantId, sessionData: { version: 1, sessions: {} } });
  const loaded = await invoke('session-api', { action: 'load', participantId });
  if ((write && !loaded.found) || loaded.sessionData?.version !== 1) throw new Error('Supabase 세션 저장·조회 검증 실패');
  const profiles = await invoke('voice-profile-api', { action: 'list' });
  if (!Array.isArray(profiles.profiles)) throw new Error('Supabase 음성 프로필 조회 검증 실패');
  const manifest = await json('data/processed/db-manifest.json');
  await invoke('openai-proxy', { operation: 'vector_search', payload: { query: '선택', max_num_results: 1, filters: { type: 'and', filters: [
    { type: 'eq', key: 'agent_id', value: 'pathfinder' }, { type: 'eq', key: 'db_version', value: manifest.version }
  ] } } });
  console.log(`Supabase 세션${write ? ' 저장·' : ' '}조회·음성 프로필·벡터 프록시 연결 검증 완료`);
}
export async function initializeSupabase(force = false) {
  const vars = await readVars();
  const manifest = await json('data/processed/db-manifest.json');
  if (vars.OPENAI_DB_VERSION !== manifest.version) throw new Error('먼저 네 DB의 벡터 동기화를 완료하세요.');
  const signature = await fingerprint(await filesUnder('supabase'), JSON.stringify(Object.fromEntries([...remoteKeys, 'SUPABASE_PROJECT_REF'].map(key => [key, vars[key]]))));
  const previous = await json('.local/supabase-state.json').catch(() => null);
  if (force || previous?.signature !== signature) {
    console.log('Supabase 프로젝트 연결 및 미적용 마이그레이션 확인');
    await cli(['link', '--project-ref', vars.SUPABASE_PROJECT_REF, '--yes'], vars);
    await cli(['db', 'push', '--yes'], vars);
    const secretFile = '.local/supabase-secrets.env';
    await atomicWrite(secretFile, remoteKeys.map(key => `${key}=${JSON.stringify(vars[key] || '')}`).join('\n'));
    try {
      for (let attempt = 0; ; attempt++) {
        try { await cli(['secrets', 'set', '--project-ref', vars.SUPABASE_PROJECT_REF, '--env-file', secretFile], vars); break; }
        catch (error) {
          if (attempt >= 2 || !/metadata|UnexpectedStatus|429|50[0234]/.test(error.message)) throw error;
          console.log('Supabase 비밀 설정의 일시적 서버 오류를 다시 확인합니다.');
          await new Promise(done => setTimeout(done, (attempt + 1) * 3000));
        }
      }
    }
    finally { await rm(secretFile, { force: true }); }
    for (const fn of ['session-api', 'openai-proxy', 'voice-profile-api']) {
      console.log(`${fn} 배포`);
      await cli(['functions', 'deploy', fn, '--project-ref', vars.SUPABASE_PROJECT_REF, '--use-api'], vars);
    }
    await verifySupabase(vars);
    await atomicWrite('.local/supabase-state.json', JSON.stringify({ signature, verifiedAt: new Date().toISOString() }));
  } else await verifySupabase(vars);
}
export async function diagnose() {
  const problems = [];
  for (const file of ['package.json', 'package-lock.json', 'apps/worker/.dev.vars', ...(await json('packages/rag/sources.json')).map(source => source.path)]) {
    try { await access(file); } catch { problems.push(`파일 없음: ${file}`); }
  }
  const vars = await readVars().catch(() => ({}));
  for (const key of ['OPENAI_API_KEY', 'SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'NEXTGEN_PROXY_SECRET', 'VOICE_ADMIN_PASSWORD', 'VOICE_ADMIN_SESSION_SECRET']) {
    if (!isConfigured(vars[key])) problems.push(`설정 필요: ${key}`);
  }
  if (!await sourceVersionMatches().catch(() => false)) problems.push('PDF와 로컬 청크 버전 불일치: DB 동기화 필요');
  if (await needsSync().catch(() => true)) problems.push('벡터 스토어 동기화 필요');
  if (vars.OPENAI_API_KEY && isConfigured(vars.OPENAI_VECTOR_STORE_ID)) {
    try {
      const response = await fetch(`https://api.openai.com/v1/vector_stores/${encodeURIComponent(vars.OPENAI_VECTOR_STORE_ID)}`, { headers: { Authorization: `Bearer ${vars.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) problems.push(`벡터 스토어 접근 실패: HTTP ${response.status}`);
    } catch { problems.push('OpenAI 네트워크 연결 실패'); }
  }
  if (/^[a-z0-9]{20}$/.test(vars.SUPABASE_PROJECT_REF || '') && isConfigured(vars.NEXTGEN_PROXY_SECRET)) {
    try { await verifySupabase(vars, false); } catch (error) { problems.push(error.message); }
  }
  try {
    const config = await json('apps/hue-companion/.local/config.json');
    const { HueClient } = await import('../apps/hue-companion/src/hue-client.mjs');
    const lights = await new HueClient(config).listLights();
    console.log(`Hue: ${lights.length}개 전구 발견`);
  } catch { console.log('Hue: 미등록 또는 연결 끊김. 개발자 조명 탭에서 등록 가능합니다.'); }
  for (const problem of problems) console.log(`- ${problem}`);
  console.log(problems.length ? `진단 완료: ${problems.length}개 확인 항목` : '진단 완료: 설정과 자료가 준비되었습니다.');
  return problems.length;
}
async function main() {
  switch (process.argv[2]) {
    case 'prepare': return prepare();
    case 'worker-config': return writeWorkerConfig(process.argv.includes('--web'));
    case 'shutdown': {
      const control = await json('.local/control.json').catch(() => null);
      if (control) {
        try {
          await fetch('http://127.0.0.1:4173/internal/shutdown', { method: 'POST', headers: { Authorization: `Bearer ${control.token}` }, signal: AbortSignal.timeout(5000) });
        } catch { /* A server that is already stopped needs no restoration. */ }
      }
      return;
    }
    case 'supabase': return initializeSupabase(process.argv.includes('--force'));
    case 'needs-sync': process.exitCode = await needsSync() ? 10 : 0; return;
    case 'check': process.exitCode = await diagnose() ? 1 : 0; return;
    case 'stamp': {
      const lock = await fingerprint(['package-lock.json'], process.version);
      await atomicWrite('.local/install-stamp', lock); return;
    }
    case 'needs-install': {
      const expected = await fingerprint(['package-lock.json'], process.version);
      const actual = await readFile('.local/install-stamp', 'utf8').catch(() => '');
      const present = await access('node_modules/.package-lock.json').then(() => true, () => false);
      process.exitCode = actual !== expected || !present ? 10 : 0; return;
    }
    default: throw new Error('Unknown runtime command');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
