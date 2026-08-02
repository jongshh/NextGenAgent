import { AGENTS, type AgentId } from "@nextgen/agents";
import { motion } from "framer-motion";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";

interface MentorVisual {
  image: string;
  number: string;
  accent: string;
  promise: string;
}

interface MentorHubProps {
  visuals: Record<AgentId, MentorVisual>;
  hasSavedSession: boolean;
  onSelect: (agentId: AgentId) => void;
}

export function MentorHub({ visuals, hasSavedSession, onSelect }: MentorHubProps) {
  return (
    <main className="hub-shell">
      <div className="hub-topbar">
        <a className="wordmark" href="/" aria-label="NextGenAgent 홈">
          <span className="wordmark-mark">N</span>
          <span>
            <strong>NextGenAgent</strong>
            <small>AI 선배와의 만남</small>
          </span>
        </a>
        <div className="trust-note">
          <ShieldCheck size={16} />
          <span>실존 인물의 기록을 융합한 교육용 AI</span>
        </div>
      </div>

      <section className="hub-intro" aria-labelledby="hub-title">
        <p className="section-kicker">네 갈래의 질문, 네 명의 선배</p>
        <h1 id="hub-title">오늘은 누구와 이야기할까요?</h1>
        <p>
          한 사람을 흉내 내지 않습니다. 여러 사람의 청년기와 실패, 선택의 기록에서
          공통된 지혜를 찾아 새로운 선배의 목소리로 건넵니다.
        </p>
      </section>

      <section className="mentor-grid" aria-label="AI 선배 선택">
        {Object.values(AGENTS).map((agent, index) => {
          const visual = visuals[agent.id];
          return (
            <motion.article
              key={agent.id}
              className={`mentor-card mentor-card-${agent.id}`}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.42, delay: index * 0.07 }}
            >
              <img src={visual.image} alt="" />
              <div className="mentor-card-scrim" />
              <div className="mentor-card-status">
                <span>{visual.number}</span>
                {!agent.active && (
                  <span className="coming-soon">
                    <LockKeyhole size={12} />
                    준비 중
                  </span>
                )}
              </div>
              <div className="mentor-card-copy">
                <p>{visual.promise}</p>
                <h2>{agent.title}</h2>
                <blockquote>{agent.question}</blockquote>
                <button
                  type="button"
                  disabled={!agent.active}
                  onClick={() => onSelect(agent.id)}
                  data-testid={`mentor-${agent.id}`}
                  style={{ "--mentor-accent": visual.accent } as React.CSSProperties}
                >
                  {agent.active ? (hasSavedSession ? "대화 이어가기" : "대화 시작") : "곧 만나요"}
                  {agent.active && <ArrowRight size={18} />}
                </button>
              </div>
            </motion.article>
          );
        })}
      </section>
    </main>
  );
}

