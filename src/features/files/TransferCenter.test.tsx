import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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
  beforeEach(() => useTransferStore.setState({ bySession: { "session-global": [task] }, viewing: false }));

  it("opens transfer history and clears its unread badge", () => {
    render(<TransferCenter />);
    const toggle = screen.getByRole("button", { name: "传输记录" });
    expect(toggle).toHaveTextContent("1");
    fireEvent.click(toggle);
    expect(screen.getByRole("region", { name: "传输进度与历史" })).toBeInTheDocument();
    expect(screen.getByText("FunShell.exe")).toBeInTheDocument();
    expect(toggle).not.toHaveTextContent("1");
    expect(useTransferStore.getState().bySession["session-global"][0].viewed).toBe(true);
  });
});
