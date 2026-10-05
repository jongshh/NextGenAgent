import assert from 'node:assert/strict';
import test from 'node:test';
import { HueAdmin, validateManual, isPrivateAddress } from '../apps/hue-companion/src/admin.mjs';

function fixture() {
  const lights = ['a', 'b', 'c', 'd'].map(id => ({ id, type: 'light', on: { on: false }, dimming: { brightness: 20 }, color: { xy: { x: 0.3, y: 0.3 } }, connectivity: 'connected' }));
  const writes: any[] = [];
  const saved: any[] = [];
  const config = { bridgeIp: '192.168.1.2', applicationKey: 'secret-key', certificateFingerprint: 'fingerprint', targets: { pathfinder: 'a', creator: 'b', thinker: 'c', connector: 'd' } };
  const admin = new HueAdmin({ readConfig: async () => config, writeConfig: async (value: any) => { saved.push(value); }, clientFactory: () => ({ listLights: async () => lights, getLight: async (id: string) => lights.find(light => light.id === id), setLight: async (id: string, state: any) => { writes.push({ id, state }); } }) });
  return { admin, writes, saved, config };
}
test('manual state validation rejects unsafe brightness and invalid coordinates', () => {
  assert.throws(() => validateManual({ on: true, brightness: 101 }));
  assert.throws(() => validateManual({ on: true, brightness: 30, xy: { x: 0.8, y: 0.8 } }));
  assert.equal(isPrivateAddress('127.0.0.1'), false);
  assert.equal(isPrivateAddress('192.168.1.2'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});
test('mapping validation prevents duplicates and hot reloads a valid mapping', async () => {
  const { admin, saved, config } = fixture(); await admin.initialize();
  await assert.rejects(admin.mappings({ ...config.targets, connector: 'a' }), /서로 다른/);
  assert.equal(saved.length, 0);
  await admin.mappings({ ...config.targets, pathfinder: 'd', connector: 'a' });
  assert.equal(saved.length, 1);
  assert.equal(admin.controller.targets.pathfinder, 'd');
});
test('manual control cancels an automatic effect and restores the original baseline', async () => {
  const { admin, writes } = fixture(); await admin.initialize();
  await admin.preview({ agentId: 'pathfinder', responseId: 'preview', playbackMode: 'voice', cue: { preset: 'hopeful-encourage', durationMs: 3000, intensity: 'gentle' } });
  await admin.control('a', { on: true, brightness: 80 });
  assert.equal(admin.controller.current, null);
  await admin.controller.restoreLight('a');
  assert.equal(writes.at(-1).state.on.on, false);
  assert.equal(writes.at(-1).state.dimming.brightness, 20);
});
test('snapshots never return Bridge credentials and tolerate an unconfigured PC', async () => {
  const { admin } = fixture(); await admin.initialize();
  assert.doesNotMatch(JSON.stringify(await admin.snapshot()), /secret-key|fingerprint/);
  const missing = new HueAdmin({ readConfig: async () => { throw new Error('not registered'); } });
  await missing.initialize();
  assert.equal((await missing.snapshot()).configured, false);
});
