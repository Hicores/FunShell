import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/ipc";
import { mockConnections } from "../lib/mock";
import { useAppStore } from "../stores/appStore";
import type { SessionStatusEvent, WorkspaceTab } from "../types";
import { App } from "./App";

const eventCallbacks = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());

vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ipc")>();
  return {
    ...actual,
    onEvent: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
      eventCallbacks.set(name, callback);
      return () => eventCallbacks.delete(name);
    }),
  };
});
vi.mock("../components/layout/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("../components/layout/ServerSidebar", () => ({ ServerSidebar: () => null }));
vi.mock("../components/layout/Workspace", () => ({ Workspace: () => null }));
vi.mock("../features/connections/ConnectionManager", () => ({ ConnectionManager: () => null }));
vi.mock("../features/connections/ConnectionEditor", () => ({ ConnectionEditor: () => null }));
vi.mock("../features/connections/KeyManager", () => ({ KeyManager: () => null }));
vi.mock("../features/settings/SettingsDialog", () => ({ SettingsDialog: () => null }));
vi.mock("../features/security/VaultUnlockGate", () => ({ VaultUnlockGate: () => null }));
vi.mock("./useDesktopGuards", () => ({ useDesktopGuards: () => undefined }));

describe("App automatic reconnect lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    eventCallbacks.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops reconnecting after the configured maximum", async () => {
    const connection = { ...mockConnections[0], autoReconnect: true, maxReconnectAttempts: 2 };
    const terminal: WorkspaceTab = { id: "limited-retry-tab", sessionId: "limited-retry-session", connectionId: connection.id, title: connection.name, kind: "terminal", state: "connected" };
    useAppStore.setState({
      initialized: true,
      busy: false,
      connections: [connection],
      sessions: [],
      tabs: [terminal],
      activeTabId: terminal.id,
      snapshots: {},
      connectionManagerOpen: false,
      connectionEditorOpen: false,
      keyManagerOpen: false,
      settingsOpen: false,
      toast: null,
    });
    vi.spyOn(api, "transferHistory").mockResolvedValue([]);
    vi.spyOn(api, "disconnectSession").mockResolvedValue(undefined);
    const connect = vi.spyOn(api, "connectSession").mockRejectedValue(new Error("server offline"));
    render(<App />);
    await act(async () => { await Promise.resolve(); });

    const sessionStatus = eventCallbacks.get("session-status");
    expect(sessionStatus).toBeDefined();
    act(() => sessionStatus?.({ payload: { sessionId: terminal.sessionId, state: "disconnected", message: null } satisfies SessionStatusEvent }));

    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().toast).toBe("自动重连已停止，已达到最大重连次数 2");

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
