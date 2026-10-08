import { useEffect, useRef, useState } from 'react';
import { AGENTS, type AgentId } from '@nextgen/agents';

interface Light { id: string; name: string; colorSupported: boolean; connectivity: string; on: boolean; brightness: number; xy?: { x: number; y: number } }
type Emotion = 'sad' | 'anxious' | 'confused' | 'calm' | 'hopeful' | 'happy' | 'neutral';
interface LightProfile { baseColor: string; minBrightness: number; maxBrightness: number; sensitivity: number; flicker: number; cycleSeconds: number; emotionBlend: number; palettes: Record<Emotion, string[]> }
const EMOTIONS: Record<Emotion, string> = { sad: '슬픔', anxious: '불안', confused: '고민', calm: '차분함', hopeful: '희망', happy: '기쁨', neutral: '기본' };
interface Snapshot { configured: boolean; connected: boolean; bridgeIp?: string; targets: Partial<Record<AgentId, string>>; profiles?: Record<AgentId, LightProfile>; lights: Light[]; current?: { agentId: AgentId; resourceId: string; preset: string }; error?: string; updatedAt: string }
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
  const [profiles, setProfiles] = useState<Partial<Record<AgentId, LightProfile>>>({});
  const profileDirty = useRef(new Set<AgentId>());
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
      if (result.profiles) setProfiles(current => Object.fromEntries((Object.keys(AGENTS) as AgentId[]).map(id => [id, profileDirty.current.has(id) ? current[id] : result.profiles![id]])));
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
      <button disabled={busy || !ip} onClick={() => void run(pair, 'Bridge 등록 완료. 현자별 전구를 지정하세요.')}>연결·버튼 인증</button>
    </div>
    {message && <p className="voice-admin-message" role="status">{message}</p>}
    <div className="voice-profile-card">
      <h2>현자별 전구 지정</h2>
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
    <h2>현자별 대화 조명 프로필</h2>
    <p>들을 때는 현자의 기본 색상, 답변할 때는 기본 색상과 감정 팔레트를 섞어 순환합니다. 저장하면 진행 중인 효과에도 반영됩니다.</p>
    <div className="voice-profile-grid">{(Object.keys(AGENTS) as AgentId[]).map(id => profiles[id] && <ProfileCard
      key={id} id={id} profile={profiles[id]!} busy={busy} configured={Boolean(snapshot?.configured)} mapped={Boolean(snapshot?.targets[id])}
      update={profile => { profileDirty.current.add(id); setProfiles(current => ({ ...current, [id]: profile })); }}
      save={() => run(async () => { await api('profile', { agentId: id, profile: profiles[id] }); profileDirty.current.delete(id); }, `${AGENTS[id].title} 조명 프로필을 저장했습니다.`)}
      preview={emotion => run(async () => {
        await api('profile', { agentId: id, profile: profiles[id] }); profileDirty.current.delete(id);
        await api('preview', { agentId: id, responseId: crypto.randomUUID(), cue: { preset: `${emotion}-guide`, durationMs: 8000, intensity: 'standard' } });
      }, '프로필 저장 완료. 8초 동안 색상 흐름을 미리 봅니다.')}
    />)}</div>
    <div className="voice-profile-grid">{snapshot?.lights.map(light => <LightCard key={light.id} light={light} busy={busy} run={run} />)}</div>
  </section>;
}
function ProfileCard({ id, profile, busy, configured, mapped, update, save, preview }: {
  id: AgentId; profile: LightProfile; busy: boolean; configured: boolean; mapped: boolean;
  update: (profile: LightProfile) => void; save: () => Promise<void>; preview: (emotion: Emotion) => Promise<void>;
}) {
  const [emotion, setEmotion] = useState<Emotion>('hopeful');
  const change = (key: keyof LightProfile, value: number | string) => update({ ...profile, [key]: value });
  const sliders: Array<{ key: 'minBrightness' | 'maxBrightness' | 'sensitivity' | 'flicker' | 'cycleSeconds' | 'emotionBlend'; label: string; min: number; max: number; step: number }> = [
    { key: 'minBrightness', label: '최소 밝기 (%)', min: 1, max: profile.maxBrightness, step: 1 },
    { key: 'maxBrightness', label: '최대 밝기 (%)', min: profile.minBrightness, max: 100, step: 1 },
    { key: 'sensitivity', label: '음량 반응 강도', min: 0, max: 2, step: 0.05 },
    { key: 'flicker', label: '촛불 흔들림', min: 0, max: 1, step: 0.05 },
    { key: 'cycleSeconds', label: '색상 한 바퀴 (초)', min: 3, max: 30, step: 1 },
    { key: 'emotionBlend', label: '감정 색상 비중 (0=기본 색상)', min: 0, max: 1, step: 0.05 }
  ];
  return <article className="voice-profile-card hue-profile-card" aria-label={`${AGENTS[id].title} 조명 프로필`}>
    <h3>{AGENTS[id].title}</h3>
    <label>현자 기본 색상<input type="color" value={profile.baseColor} disabled={busy} onChange={e => change('baseColor', e.target.value)} /></label>
    {sliders.map(slider => <label key={slider.key}>{slider.label} · {profile[slider.key]}
      <input type="range" disabled={busy} min={slider.min} max={slider.max} step={slider.step} value={profile[slider.key]} onChange={e => change(slider.key, Number(e.target.value))} />
    </label>)}
    <label>감정 팔레트<select value={emotion} onChange={e => setEmotion(e.target.value as Emotion)}>{(Object.keys(EMOTIONS) as Emotion[]).map(key => <option key={key} value={key}>{EMOTIONS[key]}</option>)}</select></label>
    <div className="hue-palette">{profile.palettes[emotion].map((color, index) => <label key={index}>색상 {index + 1}<input type="color" disabled={busy} value={color} onChange={e => {
      const colors = [...profile.palettes[emotion]]; colors[index] = e.target.value;
      update({ ...profile, palettes: { ...profile.palettes, [emotion]: colors } });
    }} /></label>)}</div>
    <small>세 색상이 부드럽게 이어지고 마지막 색상에서 첫 색상으로 반복됩니다.</small>
    <button disabled={busy || !configured} onClick={() => void save()}>조명 프로필 저장</button>
    <button disabled={busy || !mapped} onClick={() => void preview(emotion)}>저장·색상 흐름 미리보기</button>
    {!configured && <small>Bridge 등록 후 프로필을 저장할 수 있습니다.</small>}
  </article>;
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
