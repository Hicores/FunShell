import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TransferProgressEvent } from "../../types";
import { TransferPanel } from "./TransferPanel";
import type { TransferRateSample } from "./transferStore";

const running: TransferProgressEvent = {
  sessionId: "session-1",
  taskId: "upload-1",
  direction: "upload",
  source: "C:\\builds\\release.zip",
  destination: "/root/release.zip",
  transferred: 40,
  total: 100,
  state: "running",
  updatedAt: "2026-07-18T10:00:00Z",
  viewed: false,
};

const completed: TransferProgressEvent = { ...running, taskId: "download-1", direction: "download", source: "/root/FunShell.exe", destination: "C:\\downloads\\FunShell.exe", state: "completed", transferred: 200, total: 200 };

describe("TransferPanel", () => {
  it("renders progress and history actions", () => {
    const cancel = vi.fn();
    const retry = vi.fn();
    const reveal = vi.fn();
    const clear = vi.fn();
    render(<TransferPanel transfers={[running, completed]} onCancel={cancel} onRetry={retry} onReveal={reveal} onClear={clear} onClose={vi.fn()} />);

    expect(screen.getByText("release.zip")).toBeInTheDocument();
    expect(screen.getByText("40 B / 100 B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消传输" }));
    fireEvent.click(screen.getByRole("button", { name: "清除已完成记录" }));
    expect(cancel).toHaveBeenCalledWith("upload-1");
    expect(clear).toHaveBeenCalledOnce();
  });

  it("shows the current upload or download speed for running tasks", () => {
    const rates: Record<string, TransferRateSample> = {
      "upload-1": { speedBps: 2_048, sampledAt: 10_000, transferred: 40 },
    };
    render(<TransferPanel transfers={[running]} rates={rates} now={10_500} onCancel={vi.fn()} onRetry={vi.fn()} onReveal={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText("速度 2.0 KB/s")).toBeInTheDocument();
  });

  it("shows zero speed after progress stops arriving", () => {
    const rates: Record<string, TransferRateSample> = {
      "upload-1": { speedBps: 2_048, sampledAt: 10_000, transferred: 40 },
    };
    render(<TransferPanel transfers={[running]} rates={rates} now={11_501} onCancel={vi.fn()} onRetry={vi.fn()} onReveal={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText("速度 0 B/s")).toBeInTheDocument();
  });

  it("reveals the local file from a download context menu", () => {
    const reveal = vi.fn();
    render(<TransferPanel transfers={[running, completed]} onCancel={vi.fn()} onRetry={vi.fn()} onReveal={reveal} onClear={vi.fn()} onClose={vi.fn()} />);

    fireEvent.contextMenu(screen.getByText("FunShell.exe").closest(".transfer-task")!);
    const menu = screen.getByRole("menu");
    expect(menu.querySelector("svg")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开所在文件夹" }));
    expect(reveal).toHaveBeenCalledWith(completed);
  });

  it("does not show the reveal menu for uploads", () => {
    render(<TransferPanel transfers={[running]} onCancel={vi.fn()} onRetry={vi.fn()} onReveal={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />);

    fireEvent.contextMenu(screen.getByText("release.zip").closest(".transfer-task")!);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
