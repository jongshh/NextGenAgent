import type { AgentId } from "@nextgen/agents";
import type { ConversationSession, ConversationUiVariant, SessionData } from "./types";

const STORAGE_KEY = "nextgenagent:sessions:v1";
const LAST_AGENT_KEY = "nextgenagent:last-agent:v1";
const PARTICIPANT_ID_KEY = "nextgenagent:participant-id:v1";
const CONVERSATION_UI_KEY = "nextgenagent:conversation-ui:v1";

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

export function loadAllSessions(): SessionData {
  const sessions: SessionMap = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SessionMap;
      for (const [agentId, session] of Object.entries(parsed)) {
        if (isAgentId(agentId) && isSession(session)) sessions[agentId] = session;
      }
    }
  } catch {
    // A malformed local record is treated as unavailable.
  }

  return { version: 1, sessions, ...(loadLastAgent() ? { lastAgentId: loadLastAgent()! } : {}) };
}

export function replaceAllSessions(data: SessionData): void {
  const sessions: SessionMap = {};
  for (const [agentId, session] of Object.entries(data.sessions || {})) {
    if (isAgentId(agentId) && isSession(session)) sessions[agentId] = session;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  if (data.lastAgentId && isAgentId(data.lastAgentId)) saveLastAgent(data.lastAgentId);
}

export function hasLocalSessions(): boolean {
  return Object.keys(loadAllSessions().sessions).length > 0;
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

export function loadLastAgent(): AgentId | null {
  try {
    const value = localStorage.getItem(LAST_AGENT_KEY);
    return value === "pathfinder" || value === "creator" || value === "thinker" || value === "connector"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function saveLastAgent(agentId: AgentId): void {
  try {
    localStorage.setItem(LAST_AGENT_KEY, agentId);
  } catch {
    // Session selection remains usable in memory when storage is unavailable.
  }
}

export function loadParticipantId(): string | null {
  try {
    return localStorage.getItem(PARTICIPANT_ID_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function saveParticipantId(participantId: string): void {
  try {
    localStorage.setItem(PARTICIPANT_ID_KEY, participantId.trim());
  } catch {
    // Cloud recovery remains optional when local storage is unavailable.
  }
}

export function loadConversationUiVariant(): ConversationUiVariant {
  try {
    return localStorage.getItem(CONVERSATION_UI_KEY) === "B" ? "B" : "A";
  } catch {
    return "A";
  }
}

export function saveConversationUiVariant(variant: ConversationUiVariant): void {
  try {
    localStorage.setItem(CONVERSATION_UI_KEY, variant);
  } catch {
    // The current in-memory selection still works when storage is unavailable.
  }
}

function isAgentId(value: string): value is AgentId {
  return value === "pathfinder" || value === "creator" || value === "thinker" || value === "connector";
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
