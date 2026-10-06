import { chromium } from '@playwright/test';
import { readVars } from '../scripts/config.mjs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { lightProfiles } from '../apps/hue-companion/src/profiles.mjs';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const vars = await readVars();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('artifacts/screenshots', { recursive: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    const unauthorized = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() === 401) unauthorized.push(new URL(response.url()).pathname); });
    await page.goto(`${base}/developer/lights`, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('관리자 암호').fill(vars.VOICE_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.getByRole('heading', { name: 'Bridge 등록', exact: true }).waitFor();
    await page.getByRole('button', { name: '자동 검색', exact: true }).waitFor();
    await page.screenshot({ path: `artifacts/screenshots/developer-lights-${viewport.width}.png`, fullPage: true });
    // Exercise operator controls without changing real Hue equipment.
    const ids = ['pathfinder', 'creator', 'thinker', 'connector'];
    const lights = ids.map((id, index) => ({ id: `light-${index}`, name: `테스트 전구 ${index + 1}`, colorSupported: true, connectivity: 'connected', on: false, brightness: 20, xy: { x: 0.3, y: 0.3 } }));
    const targets = Object.fromEntries(ids.map((id, index) => [id, `light-${index}`]));
    const actions = [];
    await page.route('**/api/hue/admin/**', async route => {
      const request = route.request();
      const operation = new URL(request.url()).pathname.split('/').at(-1);
      if (operation === 'status') return route.fulfill({ json: { configured: true, connected: true, bridgeIp: '192.168.1.2', profiles: lightProfiles(), lights, targets, updatedAt: new Date().toISOString() } });
      actions.push({ operation, body: request.postDataJSON() });
      return route.fulfill({ json: { ok: true } });
    });
    await page.getByRole('heading', { name: '테스트 전구 1', exact: true }).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: '전구 지정 저장', exact: true }).click();
    await page.getByText('전구 지정을 저장했습니다.', { exact: true }).waitFor();
    assert.deepEqual(actions.find(action => action.operation === 'mappings').body.targets, targets);
    await page.getByRole('button', { name: 'ON·설정 적용', exact: true }).first().click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'ON·설정 적용' && !button.disabled));
    assert.equal(actions.find(action => action.operation === 'control').body.state.on, true);
    await page.getByRole('button', { name: '전체 효과 정지·원상 복원', exact: true }).click();
    await page.getByText('복원 요청 완료. 전구 상태를 확인하세요.', { exact: true }).waitFor();
    assert.ok(actions.some(action => action.operation === 'restore'));
    const profileCard = page.getByRole('article', { name: '길을 찾는 사람 조명 프로필', exact: true });
    await profileCard.getByLabel('현자 기본 색상').fill('#ff8800');
    await profileCard.getByRole('button', { name: '조명 프로필 저장', exact: true }).click();
    await page.getByText('길을 찾는 사람 조명 프로필을 저장했습니다.', { exact: true }).waitFor();
    assert.equal(actions.find(action => action.operation === 'profile').body.profile.baseColor, '#ff8800');
    await profileCard.getByRole('button', { name: '저장·색상 흐름 미리보기', exact: true }).click();
    await page.getByText('프로필 저장 완료. 8초 동안 색상 흐름을 미리 봅니다.', { exact: true }).waitFor();
    assert.equal(actions.find(action => action.operation === 'preview').body.cue.preset, 'hopeful-guide');
    await page.screenshot({ path: `artifacts/screenshots/developer-lights-controls-${viewport.width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(unauthorized, [], 'Opening the panel and signing in must not issue unauthenticated protected requests.');
    await context.close();
  }
  console.log('Developer login and desktop/mobile lighting controls passed (equipment actions mocked).');
} finally { await browser.close(); }
