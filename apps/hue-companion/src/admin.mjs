import { HueClient, hueRequest } from './hue-client.mjs';
import { HueEffectController, validatePlayRequest } from './effects.mjs';
import { loadConfig, saveConfig } from './config.mjs';
import { lightProfiles, validateLightProfile } from './profiles.mjs';

const agents = ['pathfinder', 'creator', 'thinker', 'connector'];
export class HueAdminError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function isPrivateAddress(value) {
  const parts = typeof value === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(value) ? value.split('.').map(Number) : [];
  return parts.length === 4 && parts.every(p => p <= 255) && (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
}
export function validateManual(value) {
  if (!value || typeof value !== 'object' || typeof value.on !== 'boolean' || !Number.isFinite(value.brightness) || value.brightness < 0 || value.brightness > 100) throw new HueAdminError('ON/OFF와 0~100 밝기를 입력하세요.');
  const state = { on: { on: value.on }, dimming: { brightness: value.brightness }, dynamics: { duration: 500 } };
  if (value.xy !== undefined) {
    if (!value.xy || !['x', 'y'].every(k => Number.isFinite(value.xy[k]) && value.xy[k] >= 0 && value.xy[k] <= 1) || value.xy.x + value.xy.y > 1) throw new HueAdminError('유효한 색상 좌표가 필요합니다.');
    state.color = { xy: value.xy };
  }
  return state;
}
export class HueAdmin {
  constructor({ clientFactory = config => new HueClient(config), readConfig = loadConfig, writeConfig = saveConfig, bridgeRequest = hueRequest } = {}) {
    Object.assign(this, { clientFactory, readConfig, writeConfig, bridgeRequest });
    this.controller = null; this.config = null; this.error = null; this.pending = null;
  }
  async initialize() {
    try { this.install(await this.readConfig()); } catch (error) { this.error = error.message; }
  }
  install(config) { this.config = config; this.controller = new HueEffectController(this.clientFactory(config), config.targets, config.profiles); this.error = null; }
  async snapshot() {
    const updatedAt = new Date().toISOString();
    if (!this.controller) return { configured: false, connected: false, lights: [], targets: {}, profiles: lightProfiles(), error: this.error, updatedAt };
    try {
      const lights = await this.controller.client.listLights();
      const current = this.controller.current;
      this.error = null;
      return { configured: true, connected: true, bridgeIp: this.config.bridgeIp, targets: this.config.targets, profiles: lightProfiles(this.config.profiles),
        lights: lights.map(light => ({ id: light.id, name: light.metadata?.name || light.id, colorSupported: Boolean(light.color?.xy), connectivity: light.connectivity,
          on: Boolean(light.on?.on), brightness: light.dimming?.brightness || 0, xy: light.color?.xy })),
        current: current ? { agentId: current.agentId, resourceId: current.resourceId, preset: current.preset } : null,
        error: this.controller.lastError ? `${this.controller.lastError.at}: ${this.controller.lastError.message}` : null, updatedAt };
    } catch (error) {
      this.error = error.message;
      return { configured: true, connected: false, bridgeIp: this.config.bridgeIp, targets: this.config.targets, profiles: lightProfiles(this.config.profiles), lights: [], error: this.error, updatedAt };
    }
  }
  async discover() {
    try {
      const response = await fetch('https://discovery.meethue.com/', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      return { bridges: (await response.json()).filter(item => isPrivateAddress(item.internalipaddress)).map(item => ({ id: item.id, ip: item.internalipaddress })) };
    } catch { return { bridges: [], message: '자동 검색을 사용할 수 없습니다. Bridge IP를 직접 입력하세요.' }; }
  }
  async pairStart(ip) {
    if (!isPrivateAddress(ip)) throw new HueAdminError('사설 IPv4 Bridge 주소를 입력하세요.');
    const probe = await this.bridgeRequest({ bridgeIp: ip, path: '/api/config' });
    if (!probe.fingerprint) throw new HueAdminError('Bridge 인증서를 확인하지 못했습니다.');
    this.pending = { ip, fingerprint: probe.fingerprint, deadline: Date.now() + 45_000 };
    return { waiting: true, expiresAt: this.pending.deadline };
  }
  async pairPoll() {
    const pending = this.pending;
    if (!pending || Date.now() >= pending.deadline) { this.pending = null; throw new HueAdminError('버튼 인증 시간이 만료되었습니다. 다시 연결하세요.'); }
    const response = await this.bridgeRequest({ bridgeIp: pending.ip, path: '/api', method: 'POST', expectedFingerprint: pending.fingerprint,
      body: { devicetype: 'nextgenagent#hue-companion', generateclientkey: true } });
    const success = response.data?.find?.(item => item.success)?.success;
    if (!success?.username) {
      if (response.data?.some?.(item => item.error?.type === 101)) return { waiting: true };
      throw new HueAdminError('Bridge 인증에 실패했습니다.');
    }
    const config = { bridgeIp: pending.ip, applicationKey: success.username, certificateFingerprint: pending.fingerprint, targets: {}, profiles: lightProfiles(this.config?.profiles) };
    if (this.controller) await this.controller.reset();
    await this.writeConfig(config); this.install(config); this.pending = null;
    return { waiting: false, connected: true };
  }
  requireController() { if (!this.controller) throw new HueAdminError('먼저 Bridge를 등록하세요.', 503); return this.controller; }
  async light(id, colorRequired = false) {
    const controller = this.requireController();
    const lights = await controller.client.listLights();
    const light = lights.find(light => light.id === id);
    if (!light || (colorRequired && !light.color?.xy)) throw new HueAdminError('등록된 컬러 전구를 선택하세요.');
    return light;
  }
  async mappings(targets) {
    if (!targets || Object.keys(targets).length !== 4 || agents.some(id => typeof targets[id] !== 'string') || new Set(Object.values(targets)).size !== 4) throw new HueAdminError('네 선배에 서로 다른 컬러 전구를 지정하세요.');
    for (const id of Object.values(targets)) await this.light(id, true);
    await this.controller.reset();
    const config = { ...this.config, targets };
    await this.writeConfig(config); this.install(config);
    return { ok: true };
  }
  async control(id, value) {
    const state = validateManual(value);
    await this.light(id, Boolean(state.color));
    await this.controller.manual(id, state); return { ok: true };
  }
  async profile(agentId, value) {
    if (!agents.includes(agentId)) throw new HueAdminError('현자를 선택하세요.');
    this.requireController();
    let profile;
    try { profile = validateLightProfile(value); } catch (error) { throw new HueAdminError(error.message); }
    const profiles = { ...lightProfiles(this.config.profiles), [agentId]: profile };
    const config = { ...this.config, profiles };
    await this.writeConfig(config);
    this.config = config;
    this.controller.profiles = profiles;
    return { ok: true, profile };
  }
  async identify(id) {
    await this.light(id);
    // Preserve both the operator baseline and the current visible state.
    const original = await this.controller.client.getLight(id);
    if (this.controller.current?.resourceId === id) await this.controller.stop(undefined, false);
    try {
      await this.controller.client.setLight(id, { on: { on: true }, dimming: { brightness: 70 }, dynamics: { duration: 200 } });
      await new Promise(resolve => setTimeout(resolve, 900));
    } finally { await this.controller.restore(id, original); }
    return { ok: true };
  }
  async preview(value) {
    const request = validatePlayRequest(value);
    if (!request) throw new HueAdminError('조명 효과 설정이 올바르지 않습니다.');
    await this.light(this.config?.targets[request.agentId], true);
    await this.controller.play(request); return { ok: true };
  }
}
