import { Plus, Server, X } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../../stores/appStore";
import { HomeView } from "../../features/home/HomeView";
import { TerminalWorkspace } from "../../features/terminal/TerminalWorkspace";
import { SystemInfoView } from "../../features/monitor/SystemInfoView";
import { ProcessView } from "../../features/processes/ProcessView";
import { NetworkView } from "../../features/network/NetworkView";
import { TunnelView } from "../../features/tunnels/TunnelView";
import { ToolsDrawer } from "./ToolsDrawer";
import { IconButton } from "../common/IconButton";
import { ContextMenu } from "../common/ContextMenu";

function canReconnect(state: string) {
  return state === "disconnected" || state === "error";
}

export function Workspace() {
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const closeTab = useAppStore((state) => state.closeTab);
  const reconnect = useAppStore((state) => state.reconnect);
  const openConnectionManager = useAppStore((state) => state.openConnectionManager);
  const [tabContext, setTabContext] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const contextTab = tabContext ? tabs.find((tab) => tab.id === tabContext.tabId) : undefined;

  return (
    <section className="workspace">
      <nav className="workspace-tabs">
        <button className={`home-tab ${activeTabId == null ? "active" : ""}`} type="button" title="连接列表" onClick={() => useAppStore.setState({ activeTabId: null })}>
          <Server size={17} />
        </button>
        <div className="session-tabs">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              className={`session-tab ${tab.id === activeTabId ? "active" : ""}`}
              type="button"
              title={tab.title}
              onClick={() => setActiveTab(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!canReconnect(tab.state)) {
                  setTabContext(null);
                  return;
                }
                setActiveTab(tab.id);
                setTabContext({ x: event.clientX, y: event.clientY, tabId: tab.id });
              }}
            >
              <span className={`session-status ${tab.state}`} />
              <strong>{index + 1} {tab.title}</strong>
              <span className="tab-close" role="button" tabIndex={0} title="关闭" onClick={(event) => { event.stopPropagation(); void closeTab(tab.id); }}><X size={12} /></span>
            </button>
          ))}
        </div>
        <IconButton label="新建连接" className="new-tab-button" onClick={() => openConnectionManager(true)}><Plus size={17} /></IconButton>
      </nav>

      {tabContext && contextTab && canReconnect(contextTab.state) && (
        <ContextMenu x={tabContext.x} y={tabContext.y} onClose={() => setTabContext(null)}>
          <button type="button" onClick={() => void reconnect(contextTab.sessionId)}>重新连接</button>
        </ContextMenu>
      )}

      <div className="workspace-content">
        {activeTabId == null && <HomeView />}
        {tabs.filter((tab) => tab.kind === "terminal").map((tab) => (
          <div key={tab.id} className={`workspace-page terminal-page ${activeTabId === tab.id ? "active" : ""}`}>
            <TerminalWorkspace tab={tab} active={activeTabId === tab.id} />
          </div>
        ))}
        {tabs.filter((tab) => tab.kind !== "terminal").map((tab) => (
          <div key={tab.id} className={`workspace-page ${activeTabId === tab.id ? "active" : ""}`}>
            {tab.kind === "system" && <SystemInfoView tab={tab} />}
            {tab.kind === "processes" && <ProcessView tab={tab} active={activeTabId === tab.id} />}
            {tab.kind === "network" && <NetworkView tab={tab} active={activeTabId === tab.id} />}
            {tab.kind === "tunnels" && <TunnelView tab={tab} active={activeTabId === tab.id} />}
          </div>
        ))}
        <ToolsDrawer />
      </div>
    </section>
  );
}
