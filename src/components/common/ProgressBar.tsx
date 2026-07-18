import type { ReactNode } from "react";

interface ProgressBarProps {
  value: number;
  tone?: "green" | "orange" | "red" | "blue";
  label?: ReactNode;
}

export function ProgressBar({ value, tone = "green", label }: ProgressBarProps) {
  const normalized = Math.max(0, Math.min(100, value));
  return (
    <div className={`progress-track tone-${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalized}>
      <div className="progress-fill" style={{ width: `${normalized}%` }} />
      {label != null && <span className="progress-label">{label}</span>}
    </div>
  );
}
