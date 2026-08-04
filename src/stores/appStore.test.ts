import { describe, expect, it, vi } from "vitest";
import { api } from "../lib/ipc";
import { mockConnections, mockFolders } from "../lib/mock";
import type { SessionDescriptor } from "../types";
import { useAppStore } from "./appStore";

describe("appStore tab lifecycle", () => {
  it("hydrates the saved quick-connect folder state during startup", async () => {
    const folderId = mockFolders[0].id;
    vi.spyOn(api, "getSettings").mockResolvedValue({
      geoipEnabled: true,
      confirmCloseActiveSessions: true,
      terminalFontFamily: "Consolas, monospace",
      terminalFontSize: 13,
      terminalScrollbackLines: 3000,
      quickConnectionCollapsedFolderIds: [folderId],
      processSortKey: "cpuPercent",
      processSortDirection: "desc",
    });
    useAppStore.setState({ initialized: false, quickConnectionCollapsedFolderIds: [], processSort: { key: "pid", direction: "asc" } });

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().quickConnectionCollapsedFolderIds).toEqual([folderId]);
    expect(useAppStore.getState().processSort).toEqual({ key: "cpuPercent", direction: "desc" });
  });

  it("opens a connecting terminal tab before SSH finishes", async () => {
    useAppStore.setState({ connections: mockConnections, sessions: [], tabs: [], activeTabId: null, snapshots: {}, toast: null });
    let resolveConnect: ((session: SessionDescriptor) => void) | undefined;
    const connectSession = vi.spyOn(api, "connectSession").mockImplementation(() => new Promise((resolve) => { resolveConnect = resolve; }));

    const connecting = useAppStore.getState().connect(mockConnections[0]);
    const pending = useAppStore.getState().tabs[0];
    expect(pending).toMatchObject({ connectionId: mockConnections[0].id, kind: "terminal", state: "connecting" });
    expect(useAppStore.getState().activeTabId).toBe(pending.id);
    expect(connectSession).toHaveBeenCalledWith(mockConnections[0].id, 120, 32, pending.sessionId);

    resolveConnect?.({ id: pending.sessionId, connectionId: mockConnections[0].id, title: mockConnections[0].name, state: "connected" });
    await connecting;
    expect(useAppStore.getState().tabs[0]).toMatchObject({ id: pending.id, sessionId: pending.sessionId, state: "connected" });
    expect(useAppStore.getState().toast).toBe(`已连接 ${mockConnections[0].name}`);
  });

  it("opens one tool tab per session and closes the session after its last tab", async () => {
    useAppStore.setState({ connections: mockConnections, sessions: [], tabs: [], activeTabId: null, snapshots: {}, toast: null });

    await useAppStore.getState().connect(mockConnections[0]);
    const terminal = useAppStore.getState().tabs[0];
    expect(terminal?.kind).toBe("terminal");

    useAppStore.getState().openWorkspace("processes");
    useAppStore.getState().openWorkspace("processes");
    expect(useAppStore.getState().tabs.filter((tab) => tab.kind === "processes")).toHaveLength(1);

    const reconnectEvents: CustomEvent[] = [];
    const onReconnectStatus = (event: Event) => reconnectEvents.push(event as CustomEvent);
    window.addEventListener("funshell-terminal-status", onReconnectStatus);
    const reconnected = await useAppStore.getState().reconnect(terminal!.sessionId);
    window.removeEventListener("funshell-terminal-status", onReconnectStatus);
    expect(reconnected).toBe(true);
    const reconnectedTerminal = useAppStore.getState().tabs.find((tab) => tab.kind === "terminal");
    expect(reconnectedTerminal?.sessionId).not.toBe(terminal!.sessionId);
    expect(reconnectedTerminal?.id).toBe(terminal!.id);
    expect(reconnectEvents.map((event) => event.detail.state)).toEqual(["reconnecting", "reconnected"]);
    expect(useAppStore.getState().tabs.find((tab) => tab.kind === "processes")?.sessionId).toBe(reconnectedTerminal?.sessionId);

    const processTab = useAppStore.getState().tabs.find((tab) => tab.kind === "processes");
    await useAppStore.getState().closeTab(processTab!.id);
    expect(useAppStore.getState().tabs).toHaveLength(1);

    const disconnect = vi.spyOn(api, "disconnectSession").mockImplementation(async (sessionId) => {
      expect(useAppStore.getState().tabs.some((tab) => tab.sessionId === sessionId)).toBe(false);
    });
    await useAppStore.getState().closeTab(reconnectedTerminal!.id);
    expect(disconnect).toHaveBeenCalledWith(reconnectedTerminal!.sessionId);
    expect(useAppStore.getState().tabs).toHaveLength(0);
    expect(useAppStore.getState().activeTabId).toBeNull();
  });

  it("reports a failed reconnect attempt to its caller", async () => {
    const connection = mockConnections[0];
    const terminal = { id: "retry-tab", sessionId: "retry-session", connectionId: connection.id, title: connection.name, kind: "terminal" as const, state: "disconnected" as const };
    useAppStore.setState({ connections: mockConnections, sessions: [], tabs: [terminal], activeTabId: terminal.id, snapshots: {}, toast: null });
    vi.spyOn(api, "connectSession").mockRejectedValue(new Error("offline"));

    const reconnected = await useAppStore.getState().reconnect(terminal.sessionId);

    expect(reconnected).toBe(false);
    expect(useAppStore.getState().tabs[0].state).toBe("error");
  });
});
