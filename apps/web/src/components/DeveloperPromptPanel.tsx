import { useEffect, useState } from 'react';
import { AGENTS, type AgentId, type PromptSettings } from '@nextgen/agents';

export function DeveloperPromptPanel({ workerUrl, voices }: { workerUrl: string; voices: Array<{ agentId: AgentId; voiceId: string }> }) {
  const [settings, setSettings] = useState<PromptSettings | null>(null);
  const [defaults, setDefaults] = useState<PromptSettings | null>(null);
  const [version, setVersion] = useState(0);
  const [persistent, setPersistent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function load(signal?: AbortSignal) {
    setBusy(true);
    try {
      const response = await fetch(`${workerUrl}/api/admin/prompts`, { credentials: 'include', signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '프롬프트를 불러오지 못했습니다.');
      if (signal?.aborted) return;
      setSettings(payload.settings); setDefaults(payload.defaults); setVersion(payload.version); setPersistent(payload.persistent);
      setMessage('');
    } catch (error) { if (!signal?.aborted) setMessage(error instanceof Error ? error.message : '프롬프트 조회 실패'); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [workerUrl]);
  async function save() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${workerUrl}/api/admin/prompts`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '프롬프트를 저장하지 못했습니다.');
      setSettings(payload.configuration); setVersion(payload.version);
      setMessage('프롬프트를 저장했습니다. 다음 텍스트 답변과 새 음성 세션부터 적용됩니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '프롬프트 저장 실패'); }
    finally { setBusy(false); }
  }
  const editor = (label: string, value: string, change: (value: string) => void, rows = 6) => <label>{label}<textarea disabled={busy} rows={rows} maxLength={12000} value={value} onChange={e => change(e.target.value)} /></label>;
  return <section aria-label="현자 프롬프트 관리">
    <h2>현자 프롬프트</h2>
    <p>공통 시스템 지침, 현자별 성격·말투, 답변과 GPT Live 동작 지침을 편집합니다. 저장 시 ‘선배’ 호칭은 ‘현자’로 통일됩니다.</p>
    <p>텍스트 답변에는 최신 설정이 적용됩니다. 진행 중인 음성 세션의 지침은 새 음성 세션을 시작할 때 바뀝니다. 음성 설정 탭의 말투 지침도 함께 사용됩니다.</p>
    {message && <p className="voice-admin-message" role="status">{message}</p>}
    <button disabled={busy} onClick={() => void load()}>저장된 프롬프트 다시 불러오기</button>
    {settings && <>
      {!persistent && <p role="status">프롬프트 저장소가 연결되지 않아 기본값만 표시합니다. Supabase 초기화 후 저장할 수 있습니다.</p>}
      <div className="voice-profile-grid">{(Object.keys(AGENTS) as AgentId[]).map(id => <article className="voice-profile-card" key={id} aria-label={`${AGENTS[id].title} 프롬프트`}>
        <h3>{AGENTS[id].title}</h3><p>현재 목소리: {voices.find(voice => voice.agentId === id)?.voiceId || '미확인'}</p>
        {editor('성격·대화 방식', settings.agents[id].personality, value => setSettings({ ...settings, agents: { ...settings.agents, [id]: { ...settings.agents[id], personality: value } } }))}
        {editor('목소리에 맞춘 기본 말투', settings.agents[id].voiceDirection, value => setSettings({ ...settings, agents: { ...settings.agents, [id]: { ...settings.agents[id], voiceDirection: value } } }), 4)}
      </article>)}</div>
      <div className="voice-profile-card">
        <h3>공통 시스템 프롬프트</h3>
        {editor('공통 정체성·대화 규칙', settings.commonPrompt, value => setSettings({ ...settings, commonPrompt: value }), 12)}
        <details><summary>텍스트 답변·근거·감정 태그·선택지 지침</summary>{editor('답변 시스템 프롬프트', settings.responsePrompt, value => setSettings({ ...settings, responsePrompt: value }), 18)}</details>
        <details><summary>GPT Live 음성 시스템 지침</summary>{editor('실시간 음성 시스템 프롬프트', settings.livePrompt, value => setSettings({ ...settings, livePrompt: value }), 12)}{editor('음성 미리 듣기 시스템 프롬프트', settings.previewPrompt, value => setSettings({ ...settings, previewPrompt: value }))}</details>
        <details><summary>음성 인식 방식·응답 대기 지침</summary>
          {(['tap_vad', 'wake_prefix', 'push_to_talk'] as const).map(key => <div key={key}>{editor(`인식 방식: ${{ tap_vad: '자연스러운 대화', wake_prefix: '현자님 호출', push_to_talk: '누르는 동안 말하기' }[key]}`, settings.activation[key], value => setSettings({ ...settings, activation: { ...settings.activation, [key]: value } }), 3)}</div>)}
          {(['low', 'auto', 'high'] as const).map(key => <div key={key}>{editor(`응답 대기: ${{ low: '천천히', auto: '자동', high: '빠르게' }[key]}`, settings.patience[key], value => setSettings({ ...settings, patience: { ...settings.patience, [key]: value } }), 3)}</div>)}
        </details>
        <p><small>사용 가능한 변수: {'{{title}}, {{question}}, {{personality}}, {{voiceDirection}}, {{groundingConfidence}}, {{verifiedEvidenceCount}}, {{speakingInstructions}}, {{activation}}, {{patience}}'}. 검색 근거 블록은 서버가 별도로 붙입니다.</small></p>
        <button disabled={busy || !persistent} onClick={() => void save()}>전체 프롬프트 저장</button>
        <button disabled={busy || !defaults} onClick={() => { setSettings(structuredClone(defaults)); setMessage('기본값을 편집기에 불러왔습니다. 저장해야 적용됩니다.'); }}>기본값을 편집기에 불러오기</button>
      </div>
    </>}
  </section>;
}
