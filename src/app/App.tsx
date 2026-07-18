import { useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { AppHeader } from "../components/layout/AppHeader";
import { ServerSidebar } from "../components/layout/ServerSidebar";
import { Workspace } from "../components/layout/Workspace";
import { ConnectionManager } from "../features/connections/ConnectionManager";
import { ConnectionEditor } from "../features/connections/ConnectionEditor";
import { KeyManager } from "../features/connections/KeyManager";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { useAppStore } from "../stores/appStore";
import { onEvent } from "../lib/ipc";
import type { SessionStatusEvent } from "../types";
import { useDesktopGuards } from "./useDesktopGuards";
import "../styles/layout.css";
import "../styles/controls.css";
import "../styles/views.css";

export function App() {
  useDesktopGuards();
  const initialize = useAppStore((state) => state.initialize);
  const initialized = useAppStore((state) => state.initialized);
  const busy = useAppStore((state) => state.busy);
  const toast = useAppStore((state) => state.toast);
  const notify = useAppStore((state) => state.notify);
  const reconnect = useAppStore((state) => state.reconnect);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => notify(null), 5200);
    return () => window.clearTimeout(timer);
  }, [notify, toast]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    const timers = new Set<number>();
    void onEvent<SessionStatusEvent>("session-status", (event) => {
      const payload = event.payload;
      const state = useAppStore.getState();
      const previous = state.tabs.find((tab) => tab.sessionId === payload.sessionId)?.state;
      useAppStore.setState({
        tabs: state.tabs.map((tab) => tab.sessionId === payload.sessionId ? { ...tab, state: payload.state } : tab),
      });
      if (payload.state !== "disconnected" || previous !== "connected") return;
      const terminal = state.tabs.find((tab) => tab.sessionId === payload.sessionId && tab.kind === "terminal");
      const connection = state.connections.find((item) => item.id === terminal?.connectionId);
      if (!terminal || !connection?.autoReconnect) return;
      notify("连接已中断，正在自动重连");
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (useAppStore.getState().tabs.some((tab) => tab.sessionId === payload.sessionId)) {
          void reconnect(payload.sessionId);
        }
      }, 1200);
      timers.add(timer);
    }).then((unlisten) => { dispose = unlisten; });
    return () => {
      dispose?.();
      timers.forEach(window.clearTimeout);
    };
  }, [notify, reconnect]);

  if (!initialized) {
    return (
      <main className="boot-screen">
        <LoaderCircle className="spin" size={22} />
        <span>正在初始化工作区</span>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <AppHeader />
      <div className="app-body">
        <ServerSidebar />
        <Workspace />
      </div>
      <ConnectionManager />
      <ConnectionEditor />
      <KeyManager />
      <SettingsDialog />
      {busy && <div className="busy-indicator"><LoaderCircle className="spin" size={16} />处理中</div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
