interface ThinkingDotsProps {
  label?: string;
}

export function ThinkingDots({ label = "답변을 생각하는 중" }: ThinkingDotsProps) {
  return (
    <span className="thinking-dots" role="status" aria-label={label}>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </span>
  );
}
