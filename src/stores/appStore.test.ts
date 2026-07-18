import { describe, expect, it } from "vitest";
import { mockConnections } from "../lib/mock";
import { useAppStore } from "./appStore";

describe("appStore tab lifecycle", () => {
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
    await useAppStore.getState().reconnect(terminal!.sessionId);
    window.removeEventListener("funshell-terminal-status", onReconnectStatus);
    const reconnectedTerminal = useAppStore.getState().tabs.find((tab) => tab.kind === "terminal");
    expect(reconnectedTerminal?.sessionId).not.toBe(terminal!.sessionId);
    expect(reconnectedTerminal?.id).toBe(terminal!.id);
    expect(reconnectEvents.map((event) => event.detail.state)).toEqual(["reconnecting", "reconnected"]);
    expect(useAppStore.getState().tabs.find((tab) => tab.kind === "processes")?.sessionId).toBe(reconnectedTerminal?.sessionId);

    const processTab = useAppStore.getState().tabs.find((tab) => tab.kind === "processes");
    await useAppStore.getState().closeTab(processTab!.id);
    expect(useAppStore.getState().tabs).toHaveLength(1);

    await useAppStore.getState().closeTab(reconnectedTerminal!.id);
    expect(useAppStore.getState().tabs).toHaveLength(0);
    expect(useAppStore.getState().activeTabId).toBeNull();
  });
});
