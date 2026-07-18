interface ProgressBarProps {
  value: number;
  tone?: "green" | "orange" | "red" | "blue";
}

export function ProgressBar({ value, tone = "green" }: ProgressBarProps) {
  const normalized = Math.max(0, Math.min(100, value));
  return (
    <div className={`progress-track tone-${tone}`}>
      <div className="progress-fill" style={{ width: `${normalized}%` }} />
    </div>
  );
}

