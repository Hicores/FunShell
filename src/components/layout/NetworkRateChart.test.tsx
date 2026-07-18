import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { appendNetworkRateSample, NETWORK_RATE_HISTORY_LIMIT, NetworkRateChart, rateScaleCeiling, type NetworkRateSample } from "./NetworkRateChart";

describe("NetworkRateChart", () => {
  it("plots actual upload and download samples as histogram bars", () => {
    const samples: NetworkRateSample[] = [
      { sampledAt: 1, receiveBps: 2_000, transmitBps: 1_000 },
      { sampledAt: 2, receiveBps: 8_000, transmitBps: 4_000 },
    ];
    const { container } = render(<NetworkRateChart samples={samples} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("实际速率直方图"));
    const receiveBars = container.querySelectorAll<SVGRectElement>(".receive-bar");
    const transmitBars = container.querySelectorAll<SVGRectElement>(".transmit-bar");
    expect(receiveBars).toHaveLength(2);
    expect(transmitBars).toHaveLength(2);
    expect(Number(receiveBars[0].getAttribute("x")) + Number(receiveBars[0].getAttribute("width"))).toBeCloseTo(Number(receiveBars[1].getAttribute("x")));
    expect(Number(transmitBars[0].getAttribute("x")) + Number(transmitBars[0].getAttribute("width"))).toBeCloseTo(Number(transmitBars[1].getAttribute("x")));
    expect(transmitBars[1].getAttribute("width")).toBe(receiveBars[1].getAttribute("width"));
    expect(Number(receiveBars[1].getAttribute("width"))).toBeLessThan(3);
    expect(Number(receiveBars[1].getAttribute("height"))).toBeGreaterThan(Number(transmitBars[1].getAttribute("height")));
    expect(Number(receiveBars[1].getAttribute("height"))).toBeCloseTo(57);
    expect(screen.queryByText("正在采样...")).not.toBeInTheDocument();
  });

  it("keeps only the latest visible history and uses a readable scale", () => {
    const history = Array.from({ length: NETWORK_RATE_HISTORY_LIMIT + 5 }, (_, index) => ({ sampledAt: index, receiveBps: index, transmitBps: index }));
    expect(appendNetworkRateSample(history, { sampledAt: 100, receiveBps: 100, transmitBps: 100 })).toHaveLength(NETWORK_RATE_HISTORY_LIMIT);
    expect(rateScaleCeiling(8_100)).toBe(8_100);
    expect(rateScaleCeiling(0)).toBe(1_024);
  });
});
