import type { AgentId } from "@nextgen/agents";
import type { LightCue, VoiceActivationMode, VoiceState } from "./types";

export interface MentorVoiceResult {
  message: string;
  responseId: string;
  lightCue?: LightCue | null;
}

export interface VoiceSessionCallbacks {
  onAudioLevel?: (speaker: 'user' | 'assistant', rms: number) => void;
  onState: (state: VoiceState) => void;
  onTranscript: (speaker: "user" | "assistant", text: string) => void;
  onDelegation: (text: string, turnId: string) => Promise<MentorVoiceResult | null>;
  onPlaybackStart: (result: MentorVoiceResult) => void;
  onPlaybackEnd: (result: MentorVoiceResult, spokenText: string) => void;
  onInterrupted: (result: MentorVoiceResult | null, spokenText: string) => void;
  onError: (message: string) => void;
}

export interface VoiceSessionAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  setMuted(muted: boolean): void;
  setPushToTalk(active: boolean): void;
}

interface TranscriptFragment {
  delta: string;
  startMs: number;
  endMs: number;
}

interface LiveEvent {
  type?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  delegation?: { id?: string; target?: string };
  offset_ms?: number;
  transport?: { sdp?: string };
  session?: { id?: string };
  error?: { message?: string };
}

export class OpenAiLiveAdapter implements VoiceSessionAdapter {
  private peer: RTCPeerConnection | null = null;
  private events: RTCDataChannel | null = null;
  private microphone: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private ready = false;
  private stopped = false;
  private inputFragments: TranscriptFragment[] = [];
  private lastDelegationOffset = 0;
  private processedDelegations = new Set<string>();
  private pendingResults = new Map<string, MentorVoiceResult>();
  private activeResult: MentorVoiceResult | null = null;
  private assistantTranscript = "";
  private outputTimer: number | null = null;
  private liveSessionId: string | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analysisFrame: number | null = null;
  private playbackStarted = false;
  private silentSince = 0;
  private microphoneContext: AudioContext | null = null;
  private microphoneFrame: number | null = null;

  constructor(
    private readonly workerUrl: string,
    private readonly agentId: AgentId,
    private readonly conversationId: string,
    private readonly activationMode: VoiceActivationMode,
    private readonly callbacks: VoiceSessionCallbacks
  ) {}

  async start(): Promise<void> {
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저는 실시간 음성 대화를 지원하지 않아요.");
    }
    this.stopped = false;
    this.callbacks.onState("permission");
    try {
      this.microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      this.startMicrophoneMeter(this.microphone);
      this.callbacks.onState("connecting");
      const peer = new RTCPeerConnection();
      this.peer = peer;
      const audio = new Audio();
      audio.autoplay = true;
      this.audio = audio;
      peer.addEventListener("track", (event) => {
        const stream = new MediaStream([event.track]);
        audio.srcObject = stream;
        void audio.play().catch(() => this.callbacks.onError("스피커 재생을 허용해 주세요."));
        this.startAudioMeter(stream);
      });
      peer.addEventListener("connectionstatechange", () => {
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          this.fail("음성 연결이 끊겼어요. 텍스트 대화는 계속 사용할 수 있습니다.");
        }
      });
      for (const track of this.microphone.getAudioTracks()) peer.addTrack(track, this.microphone);
      if (this.activationMode === "push_to_talk") this.setPushToTalk(false);

      const channel = peer.createDataChannel("oai-events");
      this.events = channel;
      channel.addEventListener("message", (event) => this.handleEvent(event.data));
      channel.addEventListener("close", () => {
        if (!this.stopped) this.fail("음성 세션이 종료됐어요.");
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIce(peer);
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("마이크 연결 정보를 만들지 못했어요.");
      const response = await fetch(`${this.workerUrl}/api/voice/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          agentId: this.agentId,
          conversationId: this.conversationId,
          activationMode: this.activationMode,
          sdp
        })
      });
      const result = await response.json() as {
        session?: { id?: string };
        transport?: { sdp?: string };
        error?: string | { message?: string; code?: string };
        message?: string;
        providerCode?: string;
        providerParam?: string;
      };
      if (!response.ok || !result.transport?.sdp) throw new Error(readVoiceError(result));
      this.liveSessionId = result.session?.id || null;
      await peer.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
    } catch (error) {
      this.cleanup();
      this.callbacks.onState("error");
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const endedSessionId = this.liveSessionId;
    if (this.events?.readyState === "open" && this.ready) {
      this.events.send(JSON.stringify({ type: "session.close" }));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 800));
    }
    this.cleanup();
    if (endedSessionId) {
      void fetch(`${this.workerUrl}/api/voice/session/${encodeURIComponent(endedSessionId)}/end`, {
        method: "POST",
        credentials: "include"
      }).catch(() => undefined);
    }
    this.callbacks.onState("idle");
  }

  setMuted(muted: boolean): void {
    for (const track of this.microphone?.getAudioTracks() || []) track.enabled = !muted;
  }

  setPushToTalk(active: boolean): void {
    if (this.activationMode !== "push_to_talk") return;
    this.setMuted(!active);
    this.callbacks.onState(active ? "user-speaking" : this.ready ? "listening" : "connecting");
  }

  private handleEvent(raw: unknown): void {
    let event: LiveEvent;
    try { event = JSON.parse(String(raw)) as LiveEvent; } catch { return; }
    if (event.type === "session.started") {
      this.ready = true;
      this.callbacks.onState("listening");
      return;
    }
    if (event.type === "session.closed") {
      this.stopped = true;
      this.cleanup();
      this.callbacks.onState("idle");
      return;
    }
    if (event.type === "error") {
      this.callbacks.onError(event.error?.message || "음성 세션에서 오류가 발생했어요.");
      return;
    }
    if (event.type === "session.input_transcript.delta" && typeof event.delta === "string") {
      const fragment = {
        delta: event.delta,
        startMs: event.start_ms || 0,
        endMs: event.end_ms || event.start_ms || 0
      };
      this.inputFragments.push(fragment);
      this.callbacks.onState("user-speaking");
      this.callbacks.onTranscript("user", this.currentUserTranscript());
      if (this.activeResult) this.interruptPlayback();
      return;
    }
    if (event.type === "session.output_transcript.delta" && typeof event.delta === "string") {
      if (!this.activeResult) {
        this.activeResult = this.pendingResults.values().next().value || null;
      }
      if (!this.analyser && this.activeResult && !this.playbackStarted) {
        this.playbackStarted = true;
        this.callbacks.onPlaybackStart(this.activeResult);
        this.callbacks.onState("mentor-speaking");
      }
      this.assistantTranscript += event.delta;
      this.callbacks.onTranscript("assistant", this.assistantTranscript.trim());
      if (this.outputTimer !== null) window.clearTimeout(this.outputTimer);
      this.outputTimer = window.setTimeout(() => this.finishPlayback(), 2500);
      return;
    }
    if (event.type === "session.delegation.created" && event.delegation?.target === "client" && event.delegation.id) {
      const latestTranscriptOffset = this.inputFragments.reduce(
        (latest, fragment) => Math.max(latest, fragment.endMs),
        this.lastDelegationOffset
      );
      void this.handleDelegation(event.delegation.id, event.offset_ms ?? latestTranscriptOffset);
    }
  }

  private async handleDelegation(delegationId: string, offsetMs: number): Promise<void> {
    if (this.processedDelegations.has(delegationId)) return;
    this.processedDelegations.add(delegationId);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const text = this.inputFragments
      .filter((item) => item.endMs > this.lastDelegationOffset && item.startMs <= offsetMs)
      .map((item) => item.delta)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    this.lastDelegationOffset = Math.max(this.lastDelegationOffset, offsetMs);
    const accepted = this.activationMode === "wake_prefix" ? stripWakePrefix(text) : text;
    if (!accepted) {
      if (this.events?.readyState === "open") {
        this.events.send(JSON.stringify({
          type: "session.commentary.append",
          event_id: crypto.randomUUID(),
          delegation_id: delegationId,
          content: "호출어가 없는 주변 발화다. 아무 말도 하지 말고 계속 듣는다."
        }));
      }
      this.callbacks.onState("listening");
      this.callbacks.onTranscript("user", "");
      return;
    }
    this.callbacks.onState("thinking");
    this.assistantTranscript = "";
    const turnId = crypto.randomUUID();
    const result = await this.callbacks.onDelegation(accepted, turnId);
    if (!result || this.events?.readyState !== "open" || this.stopped) {
      this.callbacks.onState("listening");
      return;
    }
    this.pendingResults.set(delegationId, result);
    this.events.send(JSON.stringify({
      type: "session.commentary.append",
      event_id: crypto.randomUUID(),
      delegation_id: delegationId,
      content: result.message
    }));
  }

  private currentUserTranscript(): string {
    return this.inputFragments
      .filter((item) => item.endMs > this.lastDelegationOffset)
      .map((item) => item.delta)
      .join("")
      .trim();
  }

  private finishPlayback(): void {
    if (this.outputTimer !== null) window.clearTimeout(this.outputTimer);
    this.outputTimer = null;
    if (this.activeResult) this.callbacks.onPlaybackEnd(this.activeResult, this.assistantTranscript.trim());
    if (this.pendingResults.size > 0) this.pendingResults.delete(this.pendingResults.keys().next().value as string);
    this.activeResult = null;
    this.playbackStarted = false;
    this.silentSince = 0;
    this.assistantTranscript = "";
    this.callbacks.onTranscript("assistant", "");
    this.callbacks.onTranscript("user", "");
    this.callbacks.onState("listening");
  }

  private interruptPlayback(): void {
    if (this.outputTimer !== null) window.clearTimeout(this.outputTimer);
    this.outputTimer = null;
    const result = this.activeResult;
    this.callbacks.onInterrupted(result, this.assistantTranscript.trim());
    this.activeResult = null;
    this.playbackStarted = false;
    this.silentSince = 0;
    this.assistantTranscript = "";
    this.callbacks.onState("interrupted");
  }

  private fail(message: string): void {
    this.callbacks.onError(message);
    this.callbacks.onState("error");
    this.cleanup();
  }

  private cleanup(): void {
    if (this.microphoneFrame !== null) window.cancelAnimationFrame(this.microphoneFrame);
    void this.microphoneContext?.close();
    this.microphoneContext = null;
    this.microphoneFrame = null;
    if (this.outputTimer !== null) window.clearTimeout(this.outputTimer);
    if (this.analysisFrame !== null) window.cancelAnimationFrame(this.analysisFrame);
    void this.audioContext?.close();
    for (const track of this.microphone?.getTracks() || []) track.stop();
    this.events?.close();
    this.peer?.close();
    if (this.audio) this.audio.srcObject = null;
    this.microphone = null;
    this.events = null;
    this.peer = null;
    this.audio = null;
    this.audioContext = null;
    this.analyser = null;
    this.analysisFrame = null;
    this.ready = false;
    this.liveSessionId = null;
  }

  private startAudioMeter(stream: MediaStream): void {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      this.audioContext = context;
      this.analyser = analyser;
      void context.resume();
      const samples = new Uint8Array(analyser.fftSize);
      const sample = () => {
        if (!this.analyser || this.stopped) return;
        this.analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / samples.length);
        this.callbacks.onAudioLevel?.('assistant', this.ready ? rms : 0);
        const audible = rms > 0.012;
        const now = performance.now();
        if (audible && this.activeResult) {
          this.silentSince = 0;
          if (!this.playbackStarted) {
            this.playbackStarted = true;
            this.callbacks.onPlaybackStart(this.activeResult);
            this.callbacks.onState("mentor-speaking");
          }
        } else if (this.playbackStarted) {
          if (!this.silentSince) this.silentSince = now;
          if (now - this.silentSince > 850) this.finishPlayback();
        }
        this.analysisFrame = window.requestAnimationFrame(sample);
      };
      this.analysisFrame = window.requestAnimationFrame(sample);
    } catch {
      // Transcript timing remains as a fallback when Web Audio is unavailable.
    }
  }

  private startMicrophoneMeter(stream: MediaStream): void {
    try {
      const context = new AudioContext();
      this.microphoneContext = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      void context.resume();
      const samples = new Float32Array(analyser.fftSize);
      const sample = () => {
        if (this.stopped || this.microphoneContext !== context) return;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        const enabled = this.ready && stream.getAudioTracks().some(track => track.enabled);
        this.callbacks.onAudioLevel?.('user', enabled ? rms : 0);
        this.microphoneFrame = window.requestAnimationFrame(sample);
      };
      this.microphoneFrame = window.requestAnimationFrame(sample);
    } catch {
      // Voice remains usable if local audio metering is unavailable.
    }
  }
}

export function stripWakePrefix(text: string): string | null {
  const normalized = text.trim().replace(/^[\s,.!?]+/, "");
  const match = normalized.match(/^현자\s*님[\s,.!?]*(.*)$/u);
  const remainder = match?.[1]?.trim();
  return remainder || null;
}

async function waitForIce(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", onChange);
      reject(new Error("음성 연결 준비 시간이 초과됐어요."));
    }, 10_000);
    function onChange() {
      if (peer.iceGatheringState !== "complete") return;
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }
    peer.addEventListener("icegatheringstatechange", onChange);
  });
}

function readVoiceError(result: {
  error?: string | { message?: string; code?: string };
  message?: string;
  providerCode?: string;
  providerParam?: string;
}): string {
  const code = typeof result.error === "string" ? result.error : result.error?.code;
  if (code === "voice_disabled") return "음성 기능이 서버에서 비활성화되어 있어요.";
  if (code === "voice_profile_disabled") return "이 현자의 음성이 비활성화되어 있어요.";
  if (code === "voice_session_rejected") {
    const detail = result.providerCode && result.providerCode !== "unknown"
      ? ` (${result.providerCode}${result.providerParam ? `: ${result.providerParam}` : ""})`
      : "";
    return `${result.message || "음성 API가 세션 요청을 거부했습니다."}${detail}`;
  }
  if (typeof result.error === "object" && result.error?.message) return result.error.message;
  if (result.message) return result.message;
  return "음성 세션을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.";
}
