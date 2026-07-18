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

    expect(screen.getByRole("img", { name: /网卡实际速率直方图/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开网络监听" }));
    expect(useAppStore.getState().tabs.some((tab) => tab.kind === "network" && tab.sessionId === terminal.sessionId)).toBe(true);
  });

  it("opens process management with one click and shows measured latency", async () => {
    const terminal: WorkspaceTab = { id: "session-process-sidebar", sessionId: "session-process-sidebar", connectionId: mockConnections[0].id, title: "Gateway", kind: "terminal", state: "connected" };
    useAppStore.setState({
      connections: mockConnections,
      tabs: [terminal],
      activeTabId: terminal.id,
      snapshots: { [terminal.sessionId]: mockSnapshot },
    });
    render(<ServerSidebar />);

    expect(await screen.findByText("24 ms")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开进程管理" }));
    expect(useAppStore.getState().tabs.some((tab) => tab.kind === "processes" && tab.sessionId === terminal.sessionId)).toBe(true);
  });

  it("renders resource values inside their progress frames", () => {
    const terminal: WorkspaceTab = { id: "session-resource-sidebar", sessionId: "session-resource-sidebar", connectionId: mockConnections[0].id, title: "Gateway", kind: "terminal", state: "connected" };
    useAppStore.setState({
      connections: mockConnections,
      tabs: [terminal],
      activeTabId: terminal.id,
      snapshots: { [terminal.sessionId]: mockSnapshot },
    });
    const { container } = render(<ServerSidebar />);

    const rows = container.querySelectorAll(".resource-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector(".progress-label")).toHaveTextContent("19%");
    expect(rows[1].querySelector(".progress-label")).toHaveTextContent("55%1.0 GB/1.9 GB");
    expect(rows[2].querySelector(".progress-label")).toHaveTextContent("14%581.7 MB/4.1 GB");
    expect(container.querySelectorAll(".resource-row em")).toHaveLength(0);
  });
});
