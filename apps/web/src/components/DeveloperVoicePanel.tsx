import { useEffect, useState } from "react";
import { AGENTS, type AgentId } from "@nextgen/agents";
import { LogOut, Play, Save, Volume2 } from "lucide-react";
import type { VoiceActivationMode } from "../types";
import { DeveloperHuePanel } from './DeveloperHuePanel';

interface VoiceProfile {
  agentId: AgentId;
  provider: "openai-live";
  model: string;
  voiceId: string;
  speakingInstructions: string;
  activationMode: VoiceActivationMode;
  eagerness: "low" | "auto" | "high";
  previewText: string;
  enabled: boolean;
  version: number;
  updatedAt?: string;
}

const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"];

export function DeveloperVoicePanel({ workerUrl }: { workerUrl: string }) {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [profilePersistent, setProfilePersistent] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'voices' | 'lights'>(() => window.location.pathname.endsWith('/lights') ? 'lights' : 'voices');

  useEffect(() => { void loadProfiles(); }, []);

  async function loadProfiles() {
    try {
      const response = await fetch(`${workerUrl}/api/admin/voice-profiles`, { credentials: "include" });
      if (response.status === 401) return;
      if (!response.ok) throw new Error("profile_load_failed");
      const payload = await response.json() as { profiles?: VoiceProfile[]; persistent?: boolean };
      setProfiles(payload.profiles || []);
      setProfilePersistent(payload.persistent === true);
      setAuthenticated(true);
    } catch {
      setMessage("음성 프로필 서버에 연결하지 못했습니다.");
    }
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${workerUrl}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password })
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error === "too_many_attempts" ? "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도하세요." : "관리자 암호가 올바르지 않습니다.");
      }
      setPassword("");
      setAuthenticated(true);
      await loadProfiles();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인하지 못했습니다.");
    } finally { setBusy(false); }
  }

  async function save(profile: VoiceProfile) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${workerUrl}/api/admin/voice-profiles/${profile.agentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...profile, version: profile.version + 1 })
      });
      if (!response.ok) throw new Error("profile_save_failed");
      setMessage(`${AGENTS[profile.agentId].title} 음성 설정을 저장했습니다. 새 음성 세션부터 적용됩니다.`);
      await loadProfiles();
    } catch {
      setMessage("저장하지 못했습니다. Supabase 마이그레이션과 voice-profile-api를 확인하세요.");
    } finally {
      setBusy(false);
    }
  }

  function update(agentId: AgentId, patch: Partial<VoiceProfile>) {
    setProfiles((current) => current.map((profile) => profile.agentId === agentId ? { ...profile, ...patch } : profile));
  }

  async function logout() {
    await fetch(`${workerUrl}/api/admin/logout`, { method: "POST", credentials: "include" });
    setAuthenticated(false);
    setProfiles([]);
    setProfilePersistent(null);
  }

  if (!authenticated) {
    return (
      <main className="voice-admin-shell">
        <form className="voice-admin-login" onSubmit={login}>
          <Volume2 size={30} />
          <h1>개발자 패널</h1>
          <p>등록된 개발자 공용 암호가 필요합니다.</p>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="관리자 암호" />
          <button type="submit" disabled={!password || busy}>로그인</button>
          {message && <p className="voice-admin-message" role="alert">{message}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="voice-admin-shell">
      <header className="voice-admin-header">
        <div><span>DEVELOPER ONLY</span><h1>개발자 패널</h1></div>
        <button type="button" onClick={() => void logout()}><LogOut size={17} /> 로그아웃</button>
      </header>
      <nav className="developer-tabs" aria-label="개발자 도구">
        <button type="button" aria-pressed={tab === 'voices'} onClick={() => setTab('voices')}>음성 설정</button>
        <button type="button" aria-pressed={tab === 'lights'} onClick={() => setTab('lights')}>조명 등록·제어</button>
      </nav>
      {tab === 'lights' ? <DeveloperHuePanel /> : <>
      <p className="voice-admin-disclosure">미리 듣기와 실제 대화에서 재생되는 목소리는 AI 합성 음성입니다. 활성 세션의 voice는 바뀌지 않으며 새 세션부터 적용됩니다.</p>
      {profilePersistent === false && <p className="voice-admin-message" role="status">현재 Supabase 음성 프로필 저장소가 연결되지 않아 기본 설정만 표시됩니다. 미리 듣기는 가능하지만 변경 사항은 저장되지 않습니다.</p>}
      {message && <p className="voice-admin-message" role="status">{message}</p>}
      <section className="voice-profile-grid">
        {profiles.map((profile) => (
          <article className="voice-profile-card" key={profile.agentId}>
            <header><div><small>{profile.agentId}</small><h2>{AGENTS[profile.agentId].title}</h2></div><label><input type="checkbox" checked={profile.enabled} onChange={(event) => update(profile.agentId, { enabled: event.target.checked })} /> 활성화</label></header>
            <label>모델<input value={profile.model} onChange={(event) => update(profile.agentId, { model: event.target.value })} /></label>
            <label>목소리<select value={profile.voiceId} onChange={(event) => update(profile.agentId, { voiceId: event.target.value })}>{VOICES.map((voice) => <option key={voice}>{voice}</option>)}</select></label>
            <label>기본 인식 방식<select value={profile.activationMode} onChange={(event) => update(profile.agentId, { activationMode: event.target.value as VoiceActivationMode })}><option value="tap_vad">자연스러운 대화</option><option value="wake_prefix">현자님 호출</option><option value="push_to_talk">누르는 동안 말하기</option></select></label>
            <label>응답 민감도<select value={profile.eagerness} onChange={(event) => update(profile.agentId, { eagerness: event.target.value as VoiceProfile["eagerness"] })}><option value="low">천천히 기다림</option><option value="auto">자동</option><option value="high">빠르게 응답</option></select></label>
            <label>말투·속도·감정 지침<textarea rows={4} value={profile.speakingInstructions} onChange={(event) => update(profile.agentId, { speakingInstructions: event.target.value })} /></label>
            <label>미리 듣기 문장<textarea rows={3} value={profile.previewText} onChange={(event) => update(profile.agentId, { previewText: event.target.value })} /></label>
            <footer>
              <button type="button" className="secondary" disabled={busy} onClick={() => void previewVoice(workerUrl, profile).catch(() => setMessage("미리 듣기를 재생하지 못했습니다."))}><Play size={16} /> 미리 듣기</button>
              <button type="button" disabled={busy} onClick={() => void save(profile)}><Save size={16} /> 저장</button>
            </footer>
          </article>
        ))}
      </section>
      </>}
    </main>
  );
}

async function previewVoice(workerUrl: string, profile: VoiceProfile): Promise<void> {
  const peer = new RTCPeerConnection();
  peer.addTransceiver("audio", { direction: "recvonly" });
  const audio = new Audio();
  audio.autoplay = true;
  peer.addEventListener("track", (event) => { audio.srcObject = new MediaStream([event.track]); void audio.play(); });
  const channel = peer.createDataChannel("oai-events");
  channel.addEventListener("message", (message) => {
    const event = JSON.parse(String(message.data)) as { type?: string };
    if (event.type === "session.started") {
      channel.send(JSON.stringify({
        type: "session.instructions.append",
        event_id: crypto.randomUUID(),
        instructions: `다음 문장을 한 번만 그대로 말하고 기다린다: ${profile.previewText}`
      }));
    }
  });
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await waitForIce(peer);
  const response = await fetch(`${workerUrl}/api/admin/voice-preview-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ agentId: profile.agentId, profile, sdp: peer.localDescription?.sdp })
  });
  const payload = await response.json() as { transport?: { sdp?: string } };
  if (!response.ok || !payload.transport?.sdp) { peer.close(); throw new Error("preview_failed"); }
  await peer.setRemoteDescription({ type: "answer", sdp: payload.transport.sdp });
  window.setTimeout(() => {
    if (channel.readyState === "open") channel.send(JSON.stringify({ type: "session.close" }));
    window.setTimeout(() => { peer.close(); audio.srcObject = null; }, 1200);
  }, 10_000);
}

async function waitForIce(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const done = () => {
      if (peer.iceGatheringState !== "complete") return;
      peer.removeEventListener("icegatheringstatechange", done);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", done);
    window.setTimeout(resolve, 5000);
  });
}
