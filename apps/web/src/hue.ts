import type { AgentId } from "@nextgen/agents";
import type { LightCue } from "./types";

export type HueConnectionState = "connected" | "offline" | "disabled";

const HUE_EFFECTS_KEY = "nextgenagent:hue-effects:v1";

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
  enabled: boolean
): Promise<boolean> {
  if (!isHueCompanionHost() || !enabled) return false;
  if (!cue) return true;
  try {
    const response = await fetch("/api/hue/play", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, responseId, cue })
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function stopHueEffects(): Promise<void> {
  if (!isHueCompanionHost()) return;
  try {
    await fetch("/api/hue/stop", {
      method: "POST",
      credentials: "same-origin"
    });
  } catch {
    // Turning the UI toggle off remains effective even if the companion is unavailable.
  }
}
