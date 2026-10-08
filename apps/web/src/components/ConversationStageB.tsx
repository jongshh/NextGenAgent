import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentConfig } from "@nextgen/agents";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpenText,
  CircleUserRound,
  RefreshCw,
  RotateCcw,
  Send
} from "lucide-react";
import { splitIntoSpokenSentences } from "../text";
import type {
  ChatAvatarProps,
  Citation,
  ConversationSession,
  ConversationTurn
} from "../types";
import { SideDrawer } from "./SideDrawer";
import { ThinkingDots } from "./ThinkingDots";

interface ConversationStageBProps {
  agent: AgentConfig;
  portrait: string;
  userAvatarUrl?: string;
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

export function ConversationStageB({
  agent,
  portrait,
  userAvatarUrl,
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
}: ConversationStageBProps) {
  const [animatedTurnId, setAnimatedTurnId] = useState<string | null>(null);
  const [revealedSentenceCount, setRevealedSentenceCount] = useState(0);
  const [revealDone, setRevealDone] = useState(true);
  const [sourceTurn, setSourceTurn] = useState<ConversationTurn | null>(null);
  const initializedRef = useRef(false);
  const revealTimerRef = useRef<number | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const latestAssistant = useMemo(
    () => [...session.turns].reverse().find((turn) => turn.role === "assistant"),
    [session.turns]
  );

  useEffect(() => {
    if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);

    const turn = latestAssistant;
    if (!turn) return;
    const sentences = splitIntoSpokenSentences(turn.content);
    const shouldAnimate = initializedRef.current || session.turns.length === 1;
    initializedRef.current = true;

    if (!shouldAnimate || sentences.length <= 1) {
      setAnimatedTurnId(null);
      setRevealedSentenceCount(sentences.length);
      setRevealDone(true);
      return;
    }

    setAnimatedTurnId(turn.id);
    setRevealedSentenceCount(1);
    setRevealDone(false);
    let count = 1;
    revealTimerRef.current = window.setInterval(() => {
      count += 1;
      setRevealedSentenceCount(Math.min(count, sentences.length));
      if (count >= sentences.length) {
        if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);
        revealTimerRef.current = null;
        setRevealDone(true);
      }
    }, 760);

    return () => {
      if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);
      revealTimerRef.current = null;
    };
  }, [latestAssistant?.id]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({
      behavior: initializedRef.current ? "smooth" : "auto",
      block: "end"
    });
  }, [session.turns.length, revealedSentenceCount, isLoading, errorMessage]);

  useEffect(() => {
    if (!isLoading) textareaRef.current?.focus();
  }, [isLoading]);

  function completeReveal() {
    if (!animatedTurnId || revealDone || !latestAssistant) return;
    if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);
    revealTimerRef.current = null;
    setRevealedSentenceCount(splitIntoSpokenSentences(latestAssistant.content).length);
    setRevealDone(true);
  }

  const latestChoices = latestAssistant?.scene?.choices || [];
  const showChoices = Boolean(latestAssistant && revealDone && !isLoading && !errorMessage);

  return (
    <main className="conversation-b-shell">
      <header className="conversation-b-toolbar">
        <button type="button" onClick={onBack} aria-label="현자 선택으로 돌아가기">
          <ArrowLeft size={19} />
        </button>
        <ChatAvatar role="assistant" imageUrl={portrait} label={agent.title} />
        <div className="conversation-b-identity">
          <strong>{agent.title}</strong>
          <span>{agent.question}</span>
        </div>
        <button type="button" onClick={onReset} aria-label="대화 새로 시작">
          <RotateCcw size={18} />
        </button>
      </header>

      <section
        className="conversation-b-transcript"
        aria-label={`${agent.title}와의 대화 기록`}
        onClick={completeReveal}
        data-testid="conversation-b-transcript"
      >
        <div className="conversation-b-feed">
          {session.turns.map((turn) => {
            if (turn.role === "user") {
              return (
                <UserMessage
                  key={turn.id}
                  turn={turn}
                  avatarUrl={userAvatarUrl}
                />
              );
            }

            const sentences = splitIntoSpokenSentences(turn.content);
            const visibleSentences = turn.id === animatedTurnId
              ? sentences.slice(0, revealedSentenceCount)
              : sentences;
            const turnComplete = turn.id !== animatedTurnId || revealDone;

            return (
              <article
                key={turn.id}
                className={`conversation-b-turn assistant safety-${turn.safetyStatus || "allowed"}`}
                data-testid="assistant-turn"
              >
                {visibleSentences.map((sentence, index) => (
                  <motion.div
                    key={`${turn.id}-${index}`}
                    className="conversation-b-line assistant"
                    initial={turn.id === animatedTurnId ? { opacity: 0, y: 7 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <ChatAvatar role="assistant" imageUrl={portrait} label={agent.title} />
                    <div className="conversation-b-bubble assistant">{sentence}</div>
                  </motion.div>
                ))}

                {turnComplete && turn.insufficientEvidence && (
                  <p className="conversation-b-caution">
                    내 경험만으로 단정하기 어려운 이야기라 조금 더 조심스럽게 답했어요.
                  </p>
                )}

                {turnComplete && (turn.citations?.length || 0) > 0 && (
                  <button
                    type="button"
                    className="conversation-b-source"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSourceTurn(turn);
                    }}
                    aria-label={`${agent.title} 답변의 바탕 열기`}
                  >
                    <BookOpenText size={14} />
                    이 답변의 바탕
                  </button>
                )}
              </article>
            );
          })}

          {isLoading && (
            <div className="conversation-b-line assistant conversation-b-thinking">
              <ChatAvatar role="assistant" imageUrl={portrait} label={agent.title} />
              <div className="conversation-b-bubble assistant">
                <ThinkingDots />
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="conversation-b-error" role="alert">
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
            {showChoices && latestChoices.length > 0 && (
              <motion.div
                className="conversation-b-choices"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {latestChoices.map((choice, index) => (
                  <button
                    type="button"
                    key={choice.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSend(choice.label);
                    }}
                    data-testid={`choice-b-${index + 1}`}
                  >
                    {choice.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={transcriptEndRef} />
        </div>
      </section>

      {voiceControl}
      <form
        className="conversation-b-composer"
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
          rows={1}
          disabled={isLoading}
        />
        <button type="submit" disabled={!input.trim() || isLoading} aria-label="보내기">
          <Send size={19} />
        </button>
      </form>

      <SideDrawer
        open={Boolean(sourceTurn)}
        title="이 답변의 바탕"
        onClose={() => setSourceTurn(null)}
      >
        <SourceList citations={sourceTurn?.citations || []} />
      </SideDrawer>
    </main>
  );
}

export function ChatAvatar({ role, imageUrl, label }: ChatAvatarProps) {
  return (
    <span className={`chat-avatar ${role}`} aria-label={label} role="img">
      {imageUrl ? <img src={imageUrl} alt="" /> : <CircleUserRound size={22} aria-hidden="true" />}
    </span>
  );
}

function UserMessage({
  turn,
  avatarUrl
}: {
  turn: ConversationTurn;
  avatarUrl?: string;
}) {
  return (
    <article className="conversation-b-turn user" data-testid="user-turn">
      <div className="conversation-b-line user">
        <ChatAvatar role="user" imageUrl={avatarUrl} label="나" />
        <div className="conversation-b-bubble user">{turn.content}</div>
      </div>
    </article>
  );
}

function SourceList({ citations }: { citations: Citation[] }) {
  return (
    <>
      <p className="drawer-lead">
        현자의 경험은 아래 자료에서 공통된 선택과 회복의 패턴을 찾아 구성했습니다.
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
    </>
  );
}
