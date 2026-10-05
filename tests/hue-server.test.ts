import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

test('Hue admin HTTP routes require both local browser and developer sessions', async () => {
  const upstream = http.createServer((request, response) => {
    const authorized = request.url === '/api/admin/session' && request.headers.cookie?.includes('nextgen_voice_admin=valid');
    response.writeHead(authorized ? 200 : 401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ authenticated: Boolean(authorized) }));
  });
  await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done));
  const upstreamPort = (upstream.address() as { port: number }).port;
  const reserve = http.createServer();
  await new Promise<void>(done => reserve.listen(0, '127.0.0.1', done));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(done => reserve.close(() => done()));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['apps/hue-companion/src/server.mjs'], { windowsHide: true, stdio: 'ignore', env: {
    ...process.env, NEXTGEN_HUE_PORT: String(port), NEXTGEN_WORKER_URL: `http://127.0.0.1:${upstreamPort}`,
    NEXTGEN_HUE_CONFIG: resolve(`.local/nonexistent-${randomUUID()}.json`), NEXTGEN_INSTANCE_ID: 'test-instance', NEXTGEN_CONTROL_TOKEN: 'test-control-token'
  } });
  try {
    for (let retry = 0; retry < 50; retry++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* starting */ }
      await new Promise(done => setTimeout(done, 100));
    }
    assert.equal((await (await fetch(`${base}/health`)).json()).instanceId, 'test-instance');
    assert.equal((await fetch(`${base}/api/hue/admin/status`)).status, 403);
    const page = await fetch(base);
    const browserCookie = page.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await fetch(`${base}/api/hue/admin/status`, { headers: { Cookie: browserCookie } })).status, 401);
    const cookies = `${browserCookie}; nextgen_voice_admin=valid`;
    assert.equal((await fetch(`${base}/api/hue/admin/status`, { headers: { Cookie: cookies, Origin: 'https://untrusted.example' } })).status, 403);
    const status = await fetch(`${base}/api/hue/admin/status`, { headers: { Cookie: cookies, Origin: base } });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).configured, false);
    assert.equal((await fetch(`${base}/internal/shutdown`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${base}/internal/shutdown`, { method: 'POST', headers: { Authorization: 'Bearer test-control-token' } })).status, 200);
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise<void>(done => upstream.close(() => done()));
  }
});
