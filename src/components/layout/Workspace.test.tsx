import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../stores/appStore";
import type { WorkspaceTab } from "../../types";
import { Workspace } from "./Workspace";

vi.mock("../../features/home/HomeView", () => ({ HomeView: () => null }));
vi.mock("../../features/terminal/TerminalWorkspace", () => ({ TerminalWorkspace: () => null }));
vi.mock("../../features/monitor/SystemInfoView", () => ({ SystemInfoView: () => null }));
vi.mock("../../features/processes/ProcessView", () => ({ ProcessView: () => null }));
vi.mock("../../features/network/NetworkView", () => ({ NetworkView: () => null }));
vi.mock("../../features/tunnels/TunnelView", () => ({ TunnelView: () => null }));
vi.mock("./ToolsDrawer", () => ({ ToolsDrawer: () => null }));

function terminal(state: WorkspaceTab["state"]): WorkspaceTab {
  return {
    id: "stable-terminal-tab",
    sessionId: "disconnected-session",
    connectionId: "connection-1",
    title: "离线服务器",
    kind: "terminal",
    state,
  };
}

describe("Workspace tab context menu", () => {
  it("reconnects a disconnected server in its existing tab", () => {
    const tab = terminal("disconnected");
    const reconnect = vi.fn().mockResolvedValue(true);
    useAppStore.setState({ tabs: [tab], activeTabId: null, reconnect });
    render(<Workspace />);

    fireEvent.contextMenu(screen.getByTitle(tab.title), { clientX: 120, clientY: 24 });
    expect(useAppStore.getState().activeTabId).toBe(tab.id);
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));

    expect(reconnect).toHaveBeenCalledWith(tab.sessionId);
    expect(useAppStore.getState().tabs[0].id).toBe(tab.id);
  });

  it("does not show reconnect for a connected tab", () => {
    const tab = terminal("connected");
    useAppStore.setState({ tabs: [tab], activeTabId: tab.id, reconnect: vi.fn().mockResolvedValue(true) });
    render(<Workspace />);

    fireEvent.contextMenu(screen.getByTitle(tab.title), { clientX: 120, clientY: 24 });

    expect(screen.queryByRole("button", { name: "重新连接" })).not.toBeInTheDocument();
  });
});
