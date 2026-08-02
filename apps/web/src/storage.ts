import type { AgentId } from "@nextgen/agents";
import type { ConversationSession } from "./types";

const STORAGE_KEY = "nextgenagent:sessions:v1";

type SessionMap = Partial<Record<AgentId, ConversationSession>>;

export function loadSession(agentId: AgentId): ConversationSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionMap;
    const session = parsed[agentId];
    return isSession(session) ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session: ConversationSession): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as SessionMap) : {};
    parsed[session.agentId] = session;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Browsers with disabled storage still get a usable in-memory session.
  }
}

export function removeSession(agentId: AgentId): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as SessionMap;
    delete parsed[agentId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore unavailable or malformed storage.
  }
}

function isSession(value: unknown): value is ConversationSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ConversationSession;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.agentId === "string" &&
    Array.isArray(candidate.turns)
  );
}

