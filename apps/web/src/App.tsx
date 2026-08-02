import { useEffect, useState } from "react";
import { AGENTS, type AgentId } from "@nextgen/agents";
import { MentorHub } from "./components/MentorHub";
import { ConversationStage } from "./components/ConversationStage";
import { ConversationStageB } from "./components/ConversationStageB";
import { SessionGate } from "./components/SessionGate";
import {
  hasLocalSessions,
  loadAllSessions,
  loadConversationUiVariant,
  loadLastAgent,
  loadParticipantId,
  loadSession,
  removeSession,
  replaceAllSessions,
  saveLastAgent,
  saveConversationUiVariant,
  saveParticipantId,
  saveSession
} from "./storage";
import type {
  ChatResponse,
  ChatScene,
  ConversationSession,
  ConversationTurn,
  ConversationUiVariant,
  SessionData
} from "./types";

const workerUrl = import.meta.env.VITE_WORKER_URL || (import.meta.env.DEV ? "http://localhost:8787" : "");

const MENTOR_VISUALS: Record<
  AgentId,
  { image: string; number: string; accent: string; promise: string }
> = {
  pathfinder: {
    image: "/assets/mentor-pathfinder-silhouette.png",
    number: "01",
    accent: "#f1b84b",
    promise: "갈림길을 지나온 선배"
  },
  creator: {
    image: "/assets/mentor-creator-silhouette.png",
    number: "02",
    accent: "#cf7565",
    promise: "멈춤을 재료로 바꾸는 선배"
  },
  thinker: {
    image: "/assets/mentor-thinker-silhouette.png",
    number: "03",
    accent: "#4fa7a0",
    promise: "정답보다 기준을 묻는 선배"
  },
  connector: {
    image: "/assets/mentor-connector-silhouette.png",
    number: "04",
    accent: "#d39b35",
    promise: "기술을 사람의 언어로 잇는 선배"
  }
};

export default function App() {
  const [accessReady, setAccessReady] = useState(() => hasLocalSessions());
  const [participantId, setParticipantId] = useState<string | null>(() => loadParticipantId());
  const [conversationUi, setConversationUi] = useState<ConversationUiVariant>(() =>
    loadConversationUiVariant()
  );
  const [sessionLookupLoading, setSessionLookupLoading] = useState(false);
  const [sessionLookupError, setSessionLookupError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<AgentId>(() => loadLastAgent() || "pathfinder");
  const [view, setView] = useState<"hub" | "conversation">(() =>
    loadSession(loadLastAgent() || "pathfinder") ? "conversation" : "hub"
  );
  const [session, setSession] = useState<ConversationSession>(() => getOrCreateSession(agentId));
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<string | null>(null);

  const agent = AGENTS[agentId];
  const savedSessions = Object.fromEntries(
    (Object.keys(AGENTS) as AgentId[]).map((id) => [id, Boolean(loadSession(id))])
  ) as Record<AgentId, boolean>;

  useEffect(() => {
    if (accessReady && participantId && hasLocalSessions()) {
      void saveCloudSnapshot(participantId);
    }
  }, [accessReady, participantId]);

  async function recoverSession(nextParticipantId: string) {
    const normalizedId = nextParticipantId.trim();
    setSessionLookupLoading(true);
    setSessionLookupError(null);

    try {
      const response = await fetch(`${workerUrl}/api/session/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: normalizedId })
      });
      const payload = (await response.json()) as {
        found?: boolean;
        sessionData?: SessionData;
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message || "session_load_failed");

      saveParticipantId(normalizedId);
      setParticipantId(normalizedId);

      if (payload.found && payload.sessionData?.version === 1) {
        replaceAllSessions(payload.sessionData);
        const recoveredAgent = payload.sessionData.lastAgentId || findNewestAgent(payload.sessionData) || "pathfinder";
        const recoveredSession = payload.sessionData.sessions[recoveredAgent];
        setAgentId(recoveredAgent);
        setSession(recoveredSession || createSession(recoveredAgent));
        setView(recoveredSession ? "conversation" : "hub");
      } else {
        setView("hub");
      }
      setAccessReady(true);
    } catch {
      setSessionLookupError("기록을 불러오지 못했어요. ID와 네트워크를 확인해 주세요.");
    } finally {
      setSessionLookupLoading(false);
    }
  }

  function enterConversation(nextAgentId: AgentId) {
    if (!AGENTS[nextAgentId].active) return;
    setAgentId(nextAgentId);
    saveLastAgent(nextAgentId);
    setSession(getOrCreateSession(nextAgentId));
    setErrorMessage(null);
    setRetryText(null);
    setView("conversation");
    if (participantId) void saveCloudSnapshot(participantId);
  }

  function changeConversationUi(variant: ConversationUiVariant) {
    setConversationUi(variant);
    saveConversationUiVariant(variant);
  }

  async function sendMessage(text: string, appendUser = true) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userTurn = makeTurn("user", trimmed);
    const nextSession = appendUser
      ? updateSession(session, [...session.turns, userTurn])
      : session;

    if (appendUser) {
      setSession(nextSession);
      saveSession(nextSession);
      if (participantId) void saveCloudSnapshot(participantId);
    }
    setInput("");
    setIsLoading(true);
    setErrorMessage(null);
    setRetryText(null);

    try {
      const response = await fetch(`${workerUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          sessionId: nextSession.id,
          messages: nextSession.turns.map(({ role, content }) => ({ role, content }))
        })
      });
      const payload = (await response.json()) as ChatResponse;

      if (!payload.scene || !payload.message) {
        throw new Error(payload.error || "invalid_response");
      }

      const assistantTurn: ConversationTurn = {
        id: createId(),
        role: "assistant",
        content: payload.message,
        createdAt: Date.now(),
        scene: payload.scene,
        groundingConfidence: payload.groundingConfidence,
        insufficientEvidence: payload.insufficientEvidence,
        citations: payload.citations || [],
        safetyStatus: payload.safety?.status || "allowed"
      };
      const completedSession = updateSession(nextSession, [...nextSession.turns, assistantTurn]);
      setSession(completedSession);
      saveSession(completedSession);
      if (participantId) void saveCloudSnapshot(participantId);

      if (!response.ok) {
        setErrorMessage("연결이 완전히 회복되지는 않았어요.");
        setRetryText(trimmed);
      }
    } catch {
      setErrorMessage("대화를 이어오는 중 연결이 끊겼어요.");
      setRetryText(trimmed);
    } finally {
      setIsLoading(false);
    }
  }

  function resetConversation() {
    const confirmed = window.confirm("이 선배와의 대화 기록을 지우고 새로 시작할까요?");
    if (!confirmed) return;
    removeSession(agentId);
    const nextSession = createSession(agentId);
    setSession(nextSession);
    saveSession(nextSession);
    if (participantId) void saveCloudSnapshot(participantId);
    setInput("");
    setErrorMessage(null);
    setRetryText(null);
  }

  if (!accessReady) {
    return (
      <SessionGate
        isLoading={sessionLookupLoading}
        errorMessage={sessionLookupError}
        onContinue={(id) => void recoverSession(id)}
      />
    );
  }

  if (view === "hub") {
    return (
      <MentorHub
        visuals={MENTOR_VISUALS}
        savedSessions={savedSessions}
        conversationUi={conversationUi}
        onConversationUiChange={changeConversationUi}
        onSelect={enterConversation}
      />
    );
  }

  if (conversationUi === "B") {
    return (
      <ConversationStageB
        agent={agent}
        portrait={MENTOR_VISUALS[agentId].image}
        session={session}
        input={input}
        isLoading={isLoading}
        errorMessage={errorMessage}
        retryText={retryText}
        onInputChange={setInput}
        onSend={(text) => void sendMessage(text)}
        onRetry={() => retryText && void sendMessage(retryText, false)}
        onReset={resetConversation}
        onBack={() => setView("hub")}
      />
    );
  }

  return (
    <ConversationStage
      agent={agent}
      portrait={MENTOR_VISUALS[agentId].image}
      session={session}
      input={input}
      isLoading={isLoading}
      errorMessage={errorMessage}
      retryText={retryText}
      onInputChange={setInput}
      onSend={(text) => void sendMessage(text)}
      onRetry={() => retryText && void sendMessage(retryText, false)}
      onReset={resetConversation}
      onBack={() => setView("hub")}
    />
  );
}

async function saveCloudSnapshot(participantId: string): Promise<void> {
  try {
    await fetch(`${workerUrl}/api/session/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, sessionData: loadAllSessions() })
    });
  } catch {
    // Local storage is the primary record; cloud sync retries on the next change or visit.
  }
}

function findNewestAgent(data: SessionData): AgentId | null {
  const sessions = Object.values(data.sessions).filter(
    (session): session is ConversationSession => Boolean(session)
  );
  sessions.sort((left, right) => right.updatedAt - left.updatedAt);
  return sessions[0]?.agentId || null;
}

function getOrCreateSession(agentId: AgentId): ConversationSession {
  return loadSession(agentId) || createSession(agentId);
}

function createSession(agentId: AgentId): ConversationSession {
  const agent = AGENTS[agentId];
  const openingScene: ChatScene = {
    speaker: agent.title,
    text: agent.openingPrompt,
    mood: "neutral",
    portraitVariant: "neutral",
    choices: agent.openingChoices.map((label, index) => ({
      id: `opening-${index + 1}`,
      label
    }))
  };
  const now = Date.now();
  return {
    id: createId(),
    agentId,
    createdAt: now,
    updatedAt: now,
    turns: [
      {
        id: createId(),
        role: "assistant",
        content: agent.openingPrompt,
        createdAt: now,
        scene: openingScene,
        citations: [],
        safetyStatus: "allowed"
      }
    ]
  };
}

function makeTurn(role: "user" | "assistant", content: string): ConversationTurn {
  return {
    id: createId(),
    role,
    content,
    createdAt: Date.now()
  };
}

function updateSession(
  session: ConversationSession,
  turns: ConversationTurn[]
): ConversationSession {
  return {
    ...session,
    turns,
    updatedAt: Date.now()
  };
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
