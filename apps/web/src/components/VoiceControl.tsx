import { Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import type { VoiceActivationMode, VoiceState } from "../types";

interface VoiceControlProps {
  state: VoiceState;
  activationMode: VoiceActivationMode;
  muted: boolean;
  userTranscript: string;
  assistantTranscript: string;
  error: string | null;
  onActivationModeChange: (mode: VoiceActivationMode) => void;
  onStart: () => void;
  onStop: () => void;
  onToggleMute: () => void;
  onPushToTalk: (active: boolean) => void;
}

export function VoiceControl(props: VoiceControlProps) {
  const active = props.state !== "idle" && props.state !== "error";
  const push = props.activationMode === "push_to_talk";
  return (
    <section className={`voice-control voice-${props.state}`} aria-label="실시간 음성 대화">
      <div className="voice-control-row">
        {!active ? (
          <button type="button" className="voice-primary" onClick={props.onStart}>
            <Mic size={18} /> 음성 대화 시작
          </button>
        ) : (
          <>
            <span className="voice-status"><i />{stateLabel(props.state)}</span>
            <button type="button" onClick={props.onToggleMute} aria-label={props.muted ? "마이크 켜기" : "마이크 끄기"}>
              {props.muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button type="button" onClick={props.onStop} aria-label="음성 대화 종료">
              <PhoneOff size={18} />
            </button>
          </>
        )}
        <select
          value={props.activationMode}
          disabled={active}
          onChange={(event) => props.onActivationModeChange(event.target.value as VoiceActivationMode)}
          aria-label="음성 인식 방식"
        >
          <option value="tap_vad">자연스러운 대화</option>
          <option value="wake_prefix">‘현자님’ 호출</option>
          <option value="push_to_talk">누르는 동안 말하기</option>
        </select>
      </div>
      {active && push && (
        <button
          type="button"
          className="push-to-talk"
          onPointerDown={() => props.onPushToTalk(true)}
          onPointerUp={() => props.onPushToTalk(false)}
          onPointerCancel={() => props.onPushToTalk(false)}
        >
          <Mic size={18} /> 누르는 동안 말하기
        </button>
      )}
      {(props.userTranscript || props.assistantTranscript) && (
        <div className="voice-captions" aria-live="polite">
          {props.userTranscript && <p><strong>나</strong>{props.userTranscript}</p>}
          {props.assistantTranscript && <p><strong><Volume2 size={14} /> 현자</strong>{props.assistantTranscript}</p>}
        </div>
      )}
      {props.error && <p className="voice-error" role="alert">{props.error}</p>}
      {!active && <small>AI가 생성한 합성 음성입니다. 원본 음성은 저장하지 않습니다.</small>}
    </section>
  );
}

function stateLabel(state: VoiceState): string {
  if (state === "permission") return "마이크 권한 확인 중";
  if (state === "connecting") return "음성 연결 중";
  if (state === "user-speaking") return "듣고 있어요";
  if (state === "thinking") return "현자가 생각 중";
  if (state === "mentor-speaking") return "현자가 말하는 중";
  if (state === "interrupted") return "말을 멈추고 듣는 중";
  return "음성 연결됨";
}
