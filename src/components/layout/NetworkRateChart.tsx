import { formatBytes } from "../../lib/format";

export interface NetworkRateSample {
  sampledAt: number;
  receiveBps: number;
  transmitBps: number;
}

export const NETWORK_RATE_HISTORY_LIMIT = 96;

export function appendNetworkRateSample(history: NetworkRateSample[], sample: NetworkRateSample) {
  return [...history, sample].slice(-NETWORK_RATE_HISTORY_LIMIT);
}

export function rateScaleCeiling(value: number) {
  return Math.max(1024, value);
}

function axisLabel(value: number) {
  return formatBytes(value, value >= 1024 * 1024 ? 1 : 0);
}

function barGeometry(samples: NetworkRateSample[], field: "receiveBps" | "transmitBps", ceiling: number) {
  const left = 34;
  const right = 4;
  const top = 5;
  const bottom = 62;
  const width = 320 - left - right;
  const step = width / NETWORK_RATE_HISTORY_LIMIT;
  return samples.map((sample, index) => {
    const slotX = left + width - (samples.length - index) * step;
    const height = Math.min(sample[field], ceiling) / ceiling * (bottom - top);
    return {
      x: slotX,
      y: bottom - height,
      width: step,
      height,
    };
  });
}

export function NetworkRateChart({ samples }: { samples: NetworkRateSample[] }) {
  const peak = Math.max(0, ...samples.flatMap((sample) => [sample.receiveBps, sample.transmitBps]));
  const ceiling = rateScaleCeiling(peak);
  const receiveBars = barGeometry(samples, "receiveBps", ceiling);
  const transmitBars = barGeometry(samples, "transmitBps", ceiling);
  const gridValues = [ceiling, ceiling * 2 / 3, ceiling / 3];

  return (
    <div className="network-chart">
      <svg viewBox="0 0 320 70" preserveAspectRatio="none" role="img" aria-label={`网卡实际速率直方图，峰值 ${axisLabel(peak)}/s`}>
        {gridValues.map((value, index) => {
          const y = 5 + index * 19;
          return <g key={value}><text x="1" y={y + 3}>{axisLabel(value)}</text><line x1="34" y1={y} x2="316" y2={y} /></g>;
        })}
        <line className="chart-baseline" x1="34" y1="62" x2="316" y2="62" />
        {receiveBars.map((bar, index) => <rect key={`receive-${samples[index].sampledAt}-${index}`} className="receive-bar" {...bar} />)}
        {transmitBars.map((bar, index) => <rect key={`transmit-${samples[index].sampledAt}-${index}`} className="transmit-bar" {...bar} />)}
      </svg>
      {samples.length < 2 && <span>正在采样...</span>}
    </div>
  );
}
