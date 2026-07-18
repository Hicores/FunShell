import { formatBytes } from "../../lib/format";

export interface NetworkRateSample {
  sampledAt: number;
  receiveBps: number;
  transmitBps: number;
}

export const NETWORK_RATE_HISTORY_LIMIT = 48;

export function appendNetworkRateSample(history: NetworkRateSample[], sample: NetworkRateSample) {
  return [...history, sample].slice(-NETWORK_RATE_HISTORY_LIMIT);
}

export function rateScaleCeiling(value: number) {
  const safeValue = Math.max(1024, value);
  const magnitude = 10 ** Math.floor(Math.log10(safeValue));
  const normalized = safeValue / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function axisLabel(value: number) {
  return formatBytes(value, value >= 1024 * 1024 ? 1 : 0);
}

function polylinePoints(samples: NetworkRateSample[], field: "receiveBps" | "transmitBps", ceiling: number) {
  const left = 34;
  const right = 4;
  const top = 5;
  const bottom = 62;
  const width = 320 - left - right;
  const step = width / (NETWORK_RATE_HISTORY_LIMIT - 1);
  return samples.map((sample, index) => {
    const x = left + width - (samples.length - 1 - index) * step;
    const y = bottom - Math.min(sample[field], ceiling) / ceiling * (bottom - top);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function NetworkRateChart({ samples }: { samples: NetworkRateSample[] }) {
  const peak = Math.max(0, ...samples.flatMap((sample) => [sample.receiveBps, sample.transmitBps]));
  const ceiling = rateScaleCeiling(peak);
  const receivePoints = polylinePoints(samples, "receiveBps", ceiling);
  const transmitPoints = polylinePoints(samples, "transmitBps", ceiling);
  const latest = samples.at(-1);
  const latestX = samples.length ? 316 : 0;
  const receiveY = latest ? 62 - Math.min(latest.receiveBps, ceiling) / ceiling * 57 : 62;
  const transmitY = latest ? 62 - Math.min(latest.transmitBps, ceiling) / ceiling * 57 : 62;
  const gridValues = [ceiling, ceiling / 2, 0];

  return (
    <div className="network-chart">
      <svg viewBox="0 0 320 70" preserveAspectRatio="none" role="img" aria-label={`网卡实际速率曲线，峰值 ${axisLabel(peak)}/s`}>
        {gridValues.map((value, index) => {
          const y = 5 + index * 28.5;
          return <g key={value}><text x="1" y={y + 3}>{axisLabel(value)}</text><line x1="34" y1={y} x2="316" y2={y} /></g>;
        })}
        <polyline className="receive-line" points={receivePoints} />
        <polyline className="transmit-line" points={transmitPoints} />
        {latest && <><circle className="receive-dot" cx={latestX} cy={receiveY} r="2" /><circle className="transmit-dot" cx={latestX} cy={transmitY} r="2" /></>}
      </svg>
      {samples.length < 2 && <span>正在采样...</span>}
    </div>
  );
}
