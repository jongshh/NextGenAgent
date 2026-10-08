import { useState, type FormEvent } from "react";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import { PARTICIPANT_ID_PATTERN } from "../session-id";

interface SessionGateProps {
  isLoading: boolean;
  errorMessage: string | null;
  onContinue: (participantId: string) => void;
}

export function SessionGate({ isLoading, errorMessage, onContinue }: SessionGateProps) {
  const [participantId, setParticipantId] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!isLoading && participantId.trim()) onContinue(participantId);
  }

  return (
    <main className="session-gate">
      <img className="session-gate-background" src="/assets/mentor-lounge.png" alt="" />
      <div className="session-gate-overlay" />
      <section className="session-gate-panel" aria-labelledby="session-title">
        <a className="wordmark wordmark-light" href="/" aria-label="NextGenAgent 홈">
          <span className="wordmark-mark">N</span>
          <span>
            <strong>NextGenAgent</strong>
            <small>AI 현자와의 만남</small>
          </span>
        </a>

        <div className="session-gate-copy">
          <p className="section-kicker">대화 기록 불러오기</p>
          <h1 id="session-title">전에 사용한 참여 ID가 있나요?</h1>
          <p>같은 ID를 입력하면 다른 기기에서도 이전 대화를 이어갈 수 있어요. 처음이라면 새 ID를 정해 주세요.</p>
        </div>

        <form onSubmit={submit} className="session-form">
          <label htmlFor="participant-id">참여 ID</label>
          <div className="session-input-row">
            <KeyRound size={19} aria-hidden="true" />
            <input
              id="participant-id"
              name="participant-id"
              value={participantId}
              onChange={(event) => setParticipantId(event.target.value)}
              minLength={4}
              maxLength={32}
              pattern={PARTICIPANT_ID_PATTERN}
              autoComplete="username"
              autoCapitalize="none"
              placeholder="예: dream2026"
              disabled={isLoading}
              required
            />
            <button type="submit" disabled={isLoading || participantId.trim().length < 4} aria-label="참여 ID로 계속">
              <ArrowRight size={20} />
            </button>
          </div>
          {errorMessage && <p className="session-error" role="alert">{errorMessage}</p>}
        </form>

        <div className="session-privacy-note">
          <ShieldCheck size={17} />
          <p>비밀번호가 없는 체험용 기능입니다. 이름, 전화번호 등 개인정보는 ID로 사용하지 마세요.</p>
        </div>
      </section>
    </main>
  );
}
