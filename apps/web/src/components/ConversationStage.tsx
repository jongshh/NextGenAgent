import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentConfig } from "@nextgen/agents";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpenText,
  History,
  RefreshCw,
  RotateCcw,
  Send
} from "lucide-react";
import type { ConversationSession, ConversationTurn } from "../types";
import { splitIntoSpokenSentences } from "../text";
import { SideDrawer } from "./SideDrawer";
import { ThinkingDots } from "./ThinkingDots";

interface ConversationStageProps {
  agent: AgentConfig;
  portrait: string;
  session: ConversationSession;
  input: string;
  isLoading: boolean;
  errorMessage: string | null;
  retryText: string | null;
  onInputChange: (value: string) => void;
  onSend: (text: string) => void;
  onRetry: () => void;
  onReset: () => void;
  onBack: () => void;
  voiceControl?: ReactNode;
}

export function ConversationStage({
  agent,
  portrait,
  session,
  input,
  isLoading,
  errorMessage,
  retryText,
  onInputChange,
  onSend,
  onRetry,
  onReset,
  onBack,
  voiceControl
}: ConversationStageProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [revealedSentenceCount, setRevealedSentenceCount] = useState(0);
  const [typingDone, setTypingDone] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const latestAssistant = useMemo(
    () => [...session.turns].reverse().find((turn) => turn.role === "assistant"),
    [session.turns]
  );
  const latestUser = useMemo(
    () => [...session.turns].reverse().find((turn) => turn.role === "user"),
    [session.turns]
  );

  useEffect(() => {
    const text = latestAssistant?.content || "";
    const sentences = splitIntoSpokenSentences(text);
    setRevealedSentenceCount(sentences.length > 0 ? 1 : 0);
    setTypingDone(false);
    if (sentences.length === 0) return;
    if (sentences.length === 1) {
      setTypingDone(true);
      return;
    }

    let count = 1;
    const timer = window.setInterval(() => {
      count += 1;
      setRevealedSentenceCount(Math.min(count, sentences.length));
      if (count >= sentences.length) {
        window.clearInterval(timer);
        setTypingDone(true);
      }
    }, 780);

    return () => window.clearInterval(timer);
  }, [latestAssistant?.id]);

  useEffect(() => {
    if (!isLoading) textareaRef.current?.focus();
  }, [isLoading]);

  const completeTyping = () => {
    if (!latestAssistant || typingDone) return;
    setRevealedSentenceCount(splitIntoSpokenSentences(latestAssistant.content).length);
    setTypingDone(true);
  };

  const choices = latestAssistant?.scene?.choices || [];
  const citations = latestAssistant?.citations || [];
  const mood = latestAssistant?.scene?.portraitVariant || "neutral";
  const spokenSentences = splitIntoSpokenSentences(latestAssistant?.content || "");

  return (
    <main className={`conversation-shell mood-${mood}`}>
      <img className="conversation-background" src="/assets/mentor-lounge.png" alt="" />
      <div className="conversation-overlay" />

      <header className="conversation-toolbar">
        <button type="button" onClick={onBack} aria-label="현자 선택으로 돌아가기">
          <ArrowLeft size={19} />
        </button>
        <div className="conversation-identity">
          <span>AI 현자 01</span>
          <strong>{agent.title}</strong>
        </div>
        <div className="toolbar-actions">
          <button type="button" onClick={() => setHistoryOpen(true)} aria-label="대화 기록 열기">
            <History size={18} />
          </button>
          <button
            type="button"
            onClick={() => setSourcesOpen(true)}
            aria-label="이 답변의 바탕 열기"
            disabled={citations.length === 0}
          >
            <BookOpenText size={18} />
          </button>
          <button type="button" onClick={onReset} aria-label="대화 새로 시작">
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      <section className="mentor-stage" aria-label={`${agent.title}와 대화`}>
        <motion.div
          className={`mentor-portrait portrait-${mood}`}
          key={mood}
          initial={{ opacity: 0.82, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.38 }}
        >
          <img src={portrait} alt={`${agent.title}의 실루엣`} />
        </motion.div>

        <div className="scene-context">
          <p>{agent.question}</p>
          {latestUser && <blockquote>“{latestUser.content}”</blockquote>}
        </div>
      </section>

      <section className="dialogue-zone">
        <AnimatePresence mode="wait">
          <motion.div
            key={isLoading ? "loading" : latestAssistant?.id || "empty"}
            className="dialogue-box"
            onClick={completeTyping}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            data-testid="dialogue-box"
          >
            <div className="nameplate">
              <span>{agent.title}</span>
              <small>{moodLabel(mood)}</small>
            </div>
            {isLoading ? (
              <p className="thinking-line">
                <ThinkingDots />
              </p>
            ) : (
              <div className="spoken-lines" aria-live="polite">
                {spokenSentences.slice(0, revealedSentenceCount).map((sentence, index) => (
                  <motion.p
                    key={`${latestAssistant?.id || "opening"}-${index}`}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    {sentence}
                  </motion.p>
                ))}
              </div>
            )}
            {!typingDone && !isLoading && <span className="typing-hint">눌러서 한 번에 보기</span>}
            {latestAssistant?.insufficientEvidence && !isLoading && (
              <p className="evidence-caution">내 경험만으로 단정하기 어려운 이야기라, 조금 더 조심스럽게 답했어요.</p>
            )}
          </motion.div>
        </AnimatePresence>

        {errorMessage && (
          <div className="retry-panel" role="alert">
            <span>{errorMessage}</span>
            {retryText && (
              <button type="button" onClick={onRetry}>
                <RefreshCw size={15} />
                다시 시도
              </button>
            )}
          </div>
        )}

        <AnimatePresence>
          {typingDone && !isLoading && !errorMessage && choices.length > 0 && (
            <motion.div
              className="choice-list"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {choices.map((choice, index) => (
                <button
                  type="button"
                  key={choice.id}
                  onClick={() => onSend(choice.label)}
                  disabled={isLoading}
                  data-testid={`choice-${index + 1}`}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {choice.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {voiceControl}
        <form
          className="conversation-composer"
          onSubmit={(event) => {
            event.preventDefault();
            onSend(input);
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSend(input);
              }
            }}
            placeholder="현자에게 지금 마음을 들려주세요."
            aria-label="현자에게 보낼 말"
            rows={2}
            disabled={isLoading}
          />
          <button type="submit" disabled={!input.trim() || isLoading} aria-label="보내기">
            <Send size={19} />
          </button>
        </form>
      </section>

      <SideDrawer open={historyOpen} title="대화 기록" onClose={() => setHistoryOpen(false)}>
        <div className="history-list">
          {session.turns.map((turn) => (
            <article key={turn.id} className={`history-turn ${turn.role}`}>
              <span>{turn.role === "user" ? "나" : agent.title}</span>
              <p>{turn.content}</p>
            </article>
          ))}
        </div>
      </SideDrawer>

      <SideDrawer open={sourcesOpen} title="이 답변의 바탕" onClose={() => setSourcesOpen(false)}>
        <p className="drawer-lead">
          현자의 말은 아래 기록에서 공통된 선택과 회복의 패턴을 찾아 구성했습니다.
        </p>
        <div className="source-list">
          {citations.map((citation) => (
            <article key={citation.id} className="source-entry">
              <header>
                <strong>{citation.personName}</strong>
                <span>p.{citation.pageRange[0]}</span>
              </header>
              <p>{citation.excerpt}</p>
              <footer>
                <span>{citation.sectionTitle}</span>
                <span>{citation.reviewStatus === "verified" ? "검수 완료" : "원문 검수 필요"}</span>
              </footer>
            </article>
          ))}
        </div>
      </SideDrawer>
    </main>
  );
}

function moodLabel(mood: string): string {
  if (mood === "encouraging") return "용기를 건네는 중";
  if (mood === "reflective") return "함께 생각하는 중";
  return "이야기를 듣는 중";
}
