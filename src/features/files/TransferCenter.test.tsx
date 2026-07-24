import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferProgressEvent } from "../../types";
import { TransferCenter } from "./TransferCenter";
import { useTransferStore } from "./transferStore";

const task: TransferProgressEvent = {
  sessionId: "session-global",
  taskId: "global-upload-1",
  direction: "upload",
  source: "C:\\builds\\FunShell.exe",
  destination: "/root/FunShell.exe",
  transferred: 100,
  total: 100,
  state: "completed",
  updatedAt: "2026-07-18T10:00:00Z",
  viewed: false,
};

describe("TransferCenter", () => {
  beforeEach(() => useTransferStore.setState({ bySession: { "session-global": [task] }, rates: {}, viewing: false }));

  it("does not show a badge for completed history", () => {
    render(<TransferCenter />);
    const toggle = screen.getByRole("button", { name: "传输记录" });
    expect(toggle).not.toHaveTextContent("1");
    fireEvent.click(toggle);
    expect(screen.getByRole("region", { name: "传输进度与历史" })).toBeInTheDocument();
    expect(screen.getByText("FunShell.exe")).toBeInTheDocument();
    expect(useTransferStore.getState().bySession["session-global"][0].viewed).toBe(true);
  });

  it("keeps the running count after opening until every task finishes", () => {
    const running: TransferProgressEvent = { ...task, state: "running", transferred: 40, total: 100, viewed: false };
    useTransferStore.setState({ bySession: { "session-global": [running] }, viewing: false });
    render(<TransferCenter />);
    const toggle = screen.getByRole("button", { name: "传输记录" });
    expect(toggle).toHaveTextContent("1");

    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("1");

    act(() => useTransferStore.getState().record({ ...running, state: "completed", transferred: 100, viewed: false }));
    expect(toggle).not.toHaveTextContent("1");
  });

  it("updates the displayed speed only on one-second boundaries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const running: TransferProgressEvent = { ...task, state: "running", transferred: 40, total: 100, viewed: false };
    useTransferStore.setState({
      bySession: { "session-global": [running] },
      rates: { [running.taskId]: { speedBps: 1_024, sampledAt: Date.now(), transferred: 40 } },
      viewing: false,
    });
    const view = render(<TransferCenter />);
    try {
      fireEvent.click(screen.getByRole("button", { name: "传输记录" }));
      expect(screen.getByText("速度 1.0 KB/s")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(200));
      act(() => useTransferStore.setState((state) => ({
        rates: { ...state.rates, [running.taskId]: { speedBps: 2_048, sampledAt: Date.now(), transferred: 80 } },
      })));
      expect(screen.getByText("速度 1.0 KB/s")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(799));
      expect(screen.getByText("速度 1.0 KB/s")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByText("速度 2.0 KB/s")).toBeInTheDocument();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("closes when focus leaves the transfer center but stays open for internal clicks", () => {
    render(<TransferCenter />);
    const toggle = screen.getByRole("button", { name: "传输记录" });
    fireEvent.click(toggle);
    const panel = screen.getByRole("region", { name: "传输进度与历史" });

    fireEvent.click(panel);
    expect(screen.getByRole("region", { name: "传输进度与历史" })).toBeInTheDocument();
    fireEvent.click(document.body);
    expect(screen.queryByRole("region", { name: "传输进度与历史" })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    fireEvent.blur(window);
    expect(screen.queryByRole("region", { name: "传输进度与历史" })).not.toBeInTheDocument();
  });
});
