import { describe, expect, it } from "vitest";
import { mockConnections } from "../lib/mock";
import { useAppStore } from "./appStore";

describe("appStore tab lifecycle", () => {
  it("opens one tool tab per session and closes the session after its last tab", async () => {
    useAppStore.setState({ sessions: [], tabs: [], activeTabId: null, snapshots: {}, toast: null });

    await useAppStore.getState().connect(mockConnections[0]);
    const terminal = useAppStore.getState().tabs[0];
    expect(terminal?.kind).toBe("terminal");

    useAppStore.getState().openWorkspace("processes");
    useAppStore.getState().openWorkspace("processes");
    expect(useAppStore.getState().tabs.filter((tab) => tab.kind === "processes")).toHaveLength(1);

    const processTab = useAppStore.getState().tabs.find((tab) => tab.kind === "processes");
    await useAppStore.getState().closeTab(processTab!.id);
    expect(useAppStore.getState().tabs).toHaveLength(1);

    await useAppStore.getState().closeTab(terminal!.id);
    expect(useAppStore.getState().tabs).toHaveLength(0);
    expect(useAppStore.getState().activeTabId).toBeNull();
  });
});
