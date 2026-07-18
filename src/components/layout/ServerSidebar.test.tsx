import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockConnections, mockSnapshot } from "../../lib/mock";
import { useAppStore } from "../../stores/appStore";
import type { WorkspaceTab } from "../../types";
import { ServerSidebar } from "./ServerSidebar";

describe("ServerSidebar", () => {
  it("opens network listeners from the speed panel", () => {
    const terminal: WorkspaceTab = { id: "session-sidebar", sessionId: "session-sidebar", connectionId: mockConnections[0].id, title: "Gateway", kind: "terminal", state: "connected" };
    useAppStore.setState({
      connections: mockConnections,
      tabs: [terminal],
      activeTabId: terminal.id,
      snapshots: { [terminal.sessionId]: mockSnapshot },
    });
    render(<ServerSidebar />);

    expect(screen.getByRole("img", { name: /网卡实际速率曲线/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开网络监听" }));
    expect(useAppStore.getState().tabs.some((tab) => tab.kind === "network" && tab.sessionId === terminal.sessionId)).toBe(true);
  });
});
