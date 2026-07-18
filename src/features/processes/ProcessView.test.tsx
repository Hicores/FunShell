import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WorkspaceTab } from "../../types";
import { ProcessView } from "./ProcessView";

const tab: WorkspaceTab = {
  id: "session-1:processes",
  sessionId: "session-1",
  connectionId: "gateway-edge",
  title: "进程-边缘网关",
  kind: "processes",
  state: "connected",
};

describe("ProcessView", () => {
  it("filters the process table by command metadata", async () => {
    render(<ProcessView tab={tab} />);
    await waitFor(() => expect(screen.getByText("java")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("搜索 PID、用户、名称或命令"), {
      target: { value: "nginx" },
    });

    expect(screen.getByText("nginx")).toBeInTheDocument();
    expect(screen.queryByText("java")).not.toBeInTheDocument();
  });
});
