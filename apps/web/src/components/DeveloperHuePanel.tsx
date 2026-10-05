import { useEffect, useRef, useState } from 'react';
import { AGENTS, type AgentId } from '@nextgen/agents';

interface Light { id: string; name: string; colorSupported: boolean; connectivity: string; on: boolean; brightness: number; xy?: { x: number; y: number } }
interface Snapshot { configured: boolean; connected: boolean; bridgeIp?: string; targets: Partial<Record<AgentId, string>>; lights: Light[]; current?: { agentId: AgentId; resourceId: string; preset: string }; error?: string; updatedAt: string }
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/hue/admin/${path}`, { credentials: 'include', ...(body === undefined ? {} : {
    method: path === 'mappings' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '조명 서버에 연결하지 못했습니다. start_program으로 실행하세요.');
  return result;
}
export function DeveloperHuePanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [targets, setTargets] = useState<Partial<Record<AgentId, string>>>({});
  const [ip, setIp] = useState('');
  const [bridges, setBridges] = useState<Array<{ id: string; ip: string }>>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const dirty = useRef(false);
  const pairing = useRef(false);
  async function refresh() {
    try {
      const result = await api('status') as Snapshot;
      if (!mounted.current) return;
      setSnapshot(result);
      if (!dirty.current) setTargets(result.targets);
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : '상태 조회 실패'); }
  }
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() { await refresh(); if (!cancelled) timer = setTimeout(poll, 3000); }
    void poll();
    return () => { cancelled = true; mounted.current = false; pairing.current = false; clearTimeout(timer); };
  }, []);
  async function run(action: () => Promise<unknown>, success = '') {
    setBusy(true); setMessage('');
    try { await action(); if (mounted.current) { setMessage(success); await refresh(); } }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : '조명 제어 실패'); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function pair() {
    await api('pair/start', { ip }); pairing.current = true;
    setMessage('45초 안에 Bridge 가운데 버튼을 누르세요.');
    try {
      while (mounted.current && pairing.current) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!mounted.current) break;
        const result = await api('pair/poll', {});
        if (!result.waiting) { dirty.current = false; return; }
      }
    } finally { pairing.current = false; }
  }
  return <section aria-label="조명 관리">
    <p role="status">{snapshot?.connected ? `Bridge 연결됨 · ${snapshot.bridgeIp}` : snapshot?.configured ? 'Bridge 연결 끊김' : 'Bridge 미등록'}</p>
    {snapshot?.error && <p role="alert">{snapshot.error}</p>}
    {snapshot && <small>갱신: {new Date(snapshot.updatedAt).toLocaleTimeString()} · {snapshot.current ? `${AGENTS[snapshot.current.agentId].title}: ${snapshot.current.preset}` : '자동 효과 대기'}</small>}
    <div className="voice-profile-card hue-bridge-card">
      <h2>Bridge 등록</h2>
      <button disabled={busy} onClick={() => void run(async () => { const result = await api('discover', {}); setBridges(result.bridges); if (result.bridges.length === 1) setIp(result.bridges[0].ip); if (result.message) setMessage(result.message); })}>자동 검색</button>
      {bridges.map(bridge => <button disabled={busy} key={bridge.ip} onClick={() => setIp(bridge.ip)}>{bridge.ip}</button>)}
      <label>Bridge 로컬 IP<input value={ip} onChange={event => setIp(event.target.value)} placeholder="192.168.1.10" /></label>
      <button disabled={busy || !ip} onClick={() => void run(pair, 'Bridge 등록 완료. 선배별 전구를 지정하세요.')}>연결·버튼 인증</button>
    </div>
    {message && <p className="voice-admin-message" role="status">{message}</p>}
    <div className="voice-profile-card">
      <h2>선배별 전구 지정</h2>
      {(Object.keys(AGENTS) as AgentId[]).map(id => <label key={id}>{AGENTS[id].title}
        <select disabled={busy} value={targets[id] || ''} onChange={event => { dirty.current = true; setTargets(current => ({ ...current, [id]: event.target.value })); }}>
          <option value="">전구 선택</option>
          {targets[id] && !snapshot?.lights.some(light => light.id === targets[id]) && <option value={targets[id]}>연결되지 않은 전구 · {targets[id]}</option>}
          {snapshot?.lights.filter(light => light.colorSupported).map(light => <option key={light.id} value={light.id}>{light.name}</option>)}
        </select>
        <button disabled={busy || !targets[id]} onClick={() => void run(() => api('identify', { id: targets[id] }))}>위치 식별</button>
        <button disabled={busy || !snapshot?.targets[id]} onClick={() => void run(() => api('preview', { agentId: id, responseId: crypto.randomUUID(), cue: { preset: 'hopeful-encourage', durationMs: 3000, intensity: 'gentle' } }))}>효과 미리보기</button>
      </label>)}
      <button disabled={busy || !snapshot?.connected} onClick={() => void run(async () => { await api('mappings', { targets }); dirty.current = false; }, '전구 지정을 저장했습니다.')}>전구 지정 저장</button>
      <button disabled={busy || !snapshot?.connected} onClick={() => void run(() => api('restore', {}), '복원 요청 완료. 전구 상태를 확인하세요.')}>전체 효과 정지·원상 복원</button>
    </div>
    <div className="voice-profile-grid">{snapshot?.lights.map(light => <LightCard key={light.id} light={light} busy={busy} run={run} />)}</div>
  </section>;
}
function LightCard({ light, busy, run }: { light: Light; busy: boolean; run: (action: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [brightness, setBrightness] = useState(light.brightness);
  const [color, setColor] = useState('#8dcc69');
  return <article className="voice-profile-card">
    <h3>{light.name}</h3><small>{light.id}</small>
    <p>{light.connectivity === 'connected' ? '연결됨' : light.connectivity === 'unknown' ? '연결 상태 미확인' : '연결 끊김'} · {light.on ? 'ON' : 'OFF'} · {Math.round(light.brightness)}% · {light.colorSupported ? '컬러 지원' : '컬러 미지원'}</p>
    {light.xy && <small>현재 색상 x={light.xy.x.toFixed(3)}, y={light.xy.y.toFixed(3)}</small>}
    <label>밝기 {Math.round(brightness)}%<input type="range" min="0" max="100" value={brightness} onChange={event => setBrightness(Number(event.target.value))} /></label>
    {light.colorSupported && <label>색상<input type="color" value={color} onChange={event => setColor(event.target.value)} /></label>}
    <button disabled={busy} onClick={() => void run(() => api('control', { id: light.id, state: { on: true, brightness, ...(light.colorSupported ? { xy: rgbToXy(color) } : {}) } }))}>ON·설정 적용</button>
    <button disabled={busy} onClick={() => void run(() => api('control', { id: light.id, state: { on: false, brightness } }))}>OFF</button>
    <button disabled={busy} onClick={() => void run(() => api('restore', { id: light.id }))}>정지·복원</button>
  </article>;
}
function rgbToXy(hex: string) {
  const [r, g, b] = [1, 3, 5].map(offset => { const c = parseInt(hex.slice(offset, offset + 2), 16) / 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; });
  const x = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const z = r * 0.000088 + g * 0.07231 + b * 0.986039;
  return x + y + z ? { x: x / (x + y + z), y: y / (x + y + z) } : { x: 0.3127, y: 0.329 };
}
