import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AGENTS, type AgentId } from "@nextgen/agents";
import "./styles.css";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Citation {
  id: string;
  personName: string;
  sectionTitle: string;
  pageRange: [number, number];
  quoteLevel: string;
  confidence: string;
  themeTags: string[];
  excerpt: string;
}

interface ChatResponse {
  message?: string;
  error?: string;
  messageText?: string;
  groundingConfidence?: "high" | "medium" | "low";
  citations?: Citation[];
}

const workerUrl = import.meta.env.VITE_WORKER_URL || "http://localhost:8787";

function App() {
  const [agentId, setAgentId] = useState<AgentId>("pathfinder");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: AGENTS.pathfinder.openingPrompt
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [confidence, setConfidence] = useState<"high" | "medium" | "low">("low");
  const activeAgent = AGENTS[agentId];

  const enabledAgents = useMemo(() => Object.values(AGENTS), []);

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const nextMessages: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(`${workerUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, messages: nextMessages })
      });
      const payload = (await response.json()) as ChatResponse;

      setCitations(payload.citations || []);
      setConfidence(payload.groundingConfidence || "low");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            payload.message ||
            payload.messageText ||
            `응답을 생성하지 못했습니다. ${payload.error ? `(${payload.error})` : ""}`
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `Worker API에 연결하지 못했습니다. ${String(error)}`
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="agent-rail">
        <div className="brand">
          <span className="brand-mark">N</span>
          <div>
            <strong>AI 선배와의 만남</strong>
            <small>대화형 선배 에이전트</small>
          </div>
        </div>

        <div className="agent-list" aria-label="에이전트 선택">
          {enabledAgents.map((agent) => (
            <button
              key={agent.id}
              className={`agent-button ${agent.id === agentId ? "selected" : ""}`}
              disabled={!agent.active}
              onClick={() => setAgentId(agent.id)}
              title={agent.active ? agent.question : "다음 마일스톤에서 활성화"}
            >
              <span>{agent.title}</span>
              <small>{agent.question}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-stage">
        <header className="chat-header">
          <div>
            <p className="eyebrow">AI 선배 01</p>
            <h1>{activeAgent.title}</h1>
            <p>{activeAgent.question}</p>
          </div>
          <div className={`confidence confidence-${confidence}`}>
            <span>근거 확신도</span>
            <strong>{confidence}</strong>
          </div>
        </header>

        <div className="conversation" aria-live="polite">
          {messages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={`message ${message.role}`}>
              <span>{message.role === "user" ? "나" : activeAgent.title}</span>
              <p>{message.content}</p>
            </article>
          ))}
          {isLoading && (
            <article className="message assistant pending">
              <span>{activeAgent.title}</span>
              <p>자료를 대조하고 답변을 구성하는 중입니다...</p>
            </article>
          )}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="고민을 적어주세요."
            rows={3}
          />
          <button type="submit" disabled={!input.trim() || isLoading} title="전송">
            →
          </button>
        </form>
      </section>

      <aside className="evidence-panel">
        <h2>근거 문단</h2>
        {citations.length === 0 ? (
          <p className="empty">아직 표시할 근거가 없습니다.</p>
        ) : (
          citations.map((citation) => (
            <article key={citation.id} className="evidence-card">
              <div>
                <strong>{citation.personName}</strong>
                <span>
                  p.{citation.pageRange[0]} · {citation.sectionTitle}
                </span>
              </div>
              <p>{citation.excerpt}</p>
              <footer>
                <span>{citation.quoteLevel}</span>
                <span>{citation.confidence}</span>
              </footer>
            </article>
          ))
        )}
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
