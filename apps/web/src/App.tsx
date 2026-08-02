import { useState } from "react";
import { AGENTS, type AgentId } from "@nextgen/agents";
import { MentorHub } from "./components/MentorHub";
import { ConversationStage } from "./components/ConversationStage";
import { loadSession, removeSession, saveSession } from "./storage";
import type { ChatResponse, ChatScene, ConversationSession, ConversationTurn } from "./types";

const workerUrl = import.meta.env.VITE_WORKER_URL || (import.meta.env.DEV ? "http://localhost:8787" : "");

const MENTOR_VISUALS: Record<
  AgentId,
  { image: string; number: string; accent: string; promise: string }
> = {
  pathfinder: {
    image: "/assets/mentor-pathfinder.png",
    number: "01",
    accent: "#f1b84b",
    promise: "갈림길을 지나온 선배"
  },
  creator: {
    image: "/assets/mentor-creator.png",
    number: "02",
    accent: "#cf7565",
    promise: "멈춤을 재료로 바꾸는 선배"
  },
  thinker: {
    image: "/assets/mentor-thinker.png",
    number: "03",
    accent: "#4fa7a0",
    promise: "정답보다 기준을 묻는 선배"
  },
  connector: {
    image: "/assets/mentor-connector.png",
    number: "04",
    accent: "#d39b35",
    promise: "기술을 사람의 언어로 잇는 선배"
  }
};

export default function App() {
  const [view, setView] = useState<"hub" | "conversation">(() =>
    loadSession("pathfinder") ? "conversation" : "hub"
  );
  const [agentId, setAgentId] = useState<AgentId>("pathfinder");
  const [session, setSession] = useState<ConversationSession>(() => getOrCreateSession("pathfinder"));
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<string | null>(null);

  const agent = AGENTS[agentId];
  const hasSavedSession = Boolean(loadSession("pathfinder"));

  function enterConversation(nextAgentId: AgentId) {
    if (!AGENTS[nextAgentId].active) return;
    setAgentId(nextAgentId);
    setSession(getOrCreateSession(nextAgentId));
    setErrorMessage(null);
    setRetryText(null);
    setView("conversation");
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
    setInput("");
    setErrorMessage(null);
    setRetryText(null);
  }

  if (view === "hub") {
    return (
      <MentorHub
        visuals={MENTOR_VISUALS}
        hasSavedSession={hasSavedSession}
        onSelect={enterConversation}
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
    choices: [
      { id: "opening-1", label: "졸업을 앞두고 무엇을 준비할지 막막해요." },
      { id: "opening-2", label: "안정적인 길과 하고 싶은 일 사이에서 고민해요." },
      { id: "opening-3", label: "실패가 많아 시작하기 늦은 것 같아요." }
    ]
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
