import type { AgentId } from "@nextgen/agents";
import type { LightCue } from "./types";

export type HueConnectionState = "connected" | "offline" | "disabled";

const HUE_EFFECTS_KEY = "nextgenagent:hue-effects:v1";

// At most one request in flight; old samples are discarded rather than queued.
export function createVoiceHueMeter(agentId: AgentId, enabled: () => boolean) {
  let pending = false;
  let lastSent = -Infinity;
  let outputLevel = 0;
  let outputAt = 0;
  let inputLevel = 0;
  let inputAt = 0;
  return (speaker: 'user' | 'assistant', rms: number) => {
    const now = performance.now();
    if (speaker === 'assistant') { outputLevel = rms; outputAt = now; }
    else { inputLevel = rms; inputAt = now; }
    if (!enabled() || !isHueCompanionHost() || pending || now - lastSent < 200) return;
    const output = now - outputAt < 300 ? outputLevel : 0;
    const input = now - inputAt < 300 ? inputLevel : 0;
    const level = Math.min(1, Math.max(0, ((output > 0.012 ? output : input) - 0.008) * 12));
    pending = true;
    lastSent = now;
    void fetch('/api/hue/audio-level', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, level, sampledAt: Date.now() }), signal: AbortSignal.timeout(1500)
    }).catch(() => undefined).finally(() => { pending = false; });
  };
}

export function isHueCompanionHost(): boolean {
  const isLoopback = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  return isLoopback && window.location.port === "4173";
}

export function loadHueEffectsEnabled(): boolean {
  if (!isHueCompanionHost()) return false;
  try {
    return localStorage.getItem(HUE_EFFECTS_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveHueEffectsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(HUE_EFFECTS_KEY, String(enabled));
  } catch {
    // The in-memory toggle remains usable when storage is unavailable.
  }
}

export async function readHueStatus(enabled: boolean): Promise<HueConnectionState> {
  if (!isHueCompanionHost() || !enabled) return "disabled";
  try {
    const response = await fetch("/api/hue/status", { credentials: "same-origin" });
    if (!response.ok) return "offline";
    const payload = await response.json() as { connected?: boolean };
    return payload.connected ? "connected" : "offline";
  } catch {
    return "offline";
  }
}

export function deriveLightCue(
  text: string,
  mood?: string,
  emotionTag?: string,
  intentTag?: string
): LightCue {
  const finalEmotion = emotionTag || (mood === "encouraging" ? "hopeful" : mood === "reflective" ? "calm" : "neutral");
  const finalIntent = intentTag || (mood === "encouraging" ? "encourage" : mood === "reflective" ? "reflect" : "guide");
  const visibleChars = text.replace(/\s/g, "").length;
  const durationMs = Math.max(3000, Math.min(8000, 2000 + Math.ceil(visibleChars / 40) * 1000));

  return {
    preset: `${finalEmotion}-${finalIntent}` as LightCue["preset"],
    durationMs,
    intensity: "gentle"
  };
}

export async function playAssistantOutput(
  agentId: AgentId,
  responseId: string,
  cue: LightCue | null | undefined,
  enabled: boolean,
  playbackMode: "timed" | "voice" = "timed",
  phase: 'listening' | 'thinking' | 'answer' = 'answer'
): Promise<boolean> {
  if (!isHueCompanionHost() || !enabled) return false;
  if (!cue) return true;
  try {
    const response = await fetch("/api/hue/play", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, responseId, cue, playbackMode, phase })
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function stopHueEffects(responseId?: string): Promise<void> {
  if (!isHueCompanionHost()) return;
  try {
    const query = responseId ? `?responseId=${encodeURIComponent(responseId)}` : "";
    await fetch(`/api/hue/stop${query}`, {
      method: "POST",
      credentials: "same-origin"
    });
  } catch {
    // Turning the UI toggle off remains effective even if the companion is unavailable.
  }
}
