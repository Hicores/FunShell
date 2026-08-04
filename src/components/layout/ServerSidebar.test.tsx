import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { mockConnections, mockSnapshot } from "../../lib/mock";
import { useAppStore } from "../../stores/appStore";
import type { WorkspaceTab } from "../../types";
import { ServerSidebar, sortSidebarProcesses } from "./ServerSidebar";

describe("ServerSidebar", () => {
  it("sorts the process summary in descending order without toggling direction", () => {
    const processes = [
      { pid: 1, user: "root", memoryBytes: 10, cpuPercent: 80, name: "cpu-heavy", command: "cpu-heavy" },
      { pid: 2, user: "root", memoryBytes: 500, cpuPercent: 5, name: "memory-heavy", command: "memory-heavy" },
    ];

    expect(sortSidebarProcesses(processes, "cpuPercent").map((process) => process.pid)).toEqual([1, 2]);
    expect(sortSidebarProcesses(processes, "memoryBytes").map((process) => process.pid)).toEqual([2, 1]);
    expect(processes.map((process) => process.pid)).toEqual([1, 2]);
  });

  it("keeps sampling connected terminal sessions that are behind the active tab", async () => {
    const foreground: WorkspaceTab = { id: "session-foreground", sessionId: "session-foreground", connectionId: mockConnections[0].id, title: "Gateway", kind: "terminal", state: "connected" };
    const background: WorkspaceTab = { id: "session-background", sessionId: "session-background", connectionId: mockConnections[1].id, title: "Database", kind: "terminal", state: "connected" };
    const snapshot = vi.spyOn(api, "snapshot");
    useAppStore.setState({
      connections: mockConnections,
      tabs: [foreground, background],
      activeTabId: foreground.id,
      snapshots: { [foreground.sessionId]: mockSnapshot, [background.sessionId]: mockSnapshot },
    });
    render(<ServerSidebar />);

    await waitFor(() => {
      expect(snapshot).toHaveBeenCalledWith(foreground.sessionId);
      expect(snapshot).toHaveBeenCalledWith(background.sessionId);
    });
  });

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

  it("masks the sidebar address until the eye button is clicked", () => {
    const terminal: WorkspaceTab = { id: "session-ip-sidebar", sessionId: "session-ip-sidebar", connectionId: mockConnections[0].id, title: "Gateway", kind: "terminal", state: "connected" };
    useAppStore.setState({
      connections: mockConnections,
      tabs: [terminal],
      activeTabId: terminal.id,
      snapshots: { [terminal.sessionId]: mockSnapshot },
    });
    render(<ServerSidebar />);

    expect(screen.getByText("139.***.229")).toBeInTheDocument();
    const reveal = screen.getByRole("button", { name: "显示完整 IP" });
    fireEvent.click(reveal);
    expect(screen.getByText(mockConnections[0].host)).toBeInTheDocument();
  });
});
