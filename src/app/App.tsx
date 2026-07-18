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
import "../styles/layout.css";
import "../styles/controls.css";
import "../styles/views.css";

export function App() {
  const initialize = useAppStore((state) => state.initialize);
  const initialized = useAppStore((state) => state.initialized);
  const busy = useAppStore((state) => state.busy);
  const toast = useAppStore((state) => state.toast);
  const notify = useAppStore((state) => state.notify);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => notify(null), 5200);
    return () => window.clearTimeout(timer);
  }, [notify, toast]);

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
