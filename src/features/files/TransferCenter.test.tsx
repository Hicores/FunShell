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
};

describe("TransferCenter", () => {
  beforeEach(() => useTransferStore.setState({ bySession: { "session-global": [task] } }));

  it("opens transfer history from the global app header", () => {
    render(<TransferCenter />);
    expect(screen.getByRole("button", { name: "传输记录" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "传输记录" }));
    expect(screen.getByRole("region", { name: "传输进度与历史" })).toBeInTheDocument();
    expect(screen.getByText("FunShell.exe")).toBeInTheDocument();
  });
});
