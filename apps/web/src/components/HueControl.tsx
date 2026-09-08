import type { HueConnectionState } from "../hue";

interface HueControlProps {
  enabled: boolean;
  state: HueConnectionState;
  onToggle: (enabled: boolean) => void;
}

const LABELS: Record<HueConnectionState, string> = {
  connected: "조명 연결됨",
  offline: "조명 오프라인",
  disabled: "조명 효과 꺼짐"
};

export function HueControl({ enabled, state, onToggle }: HueControlProps) {
  return (
    <aside className={`hue-control hue-${state}`} aria-live="polite">
      <span className="hue-status-dot" aria-hidden="true" />
      <span>{LABELS[state]}</span>
      <label className="hue-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label="스마트 조명 효과 사용"
        />
        <span>{enabled ? "켜짐" : "꺼짐"}</span>
      </label>
    </aside>
  );
}
