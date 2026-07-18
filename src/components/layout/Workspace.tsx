import { Plus, Server, X } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { HomeView } from "../../features/home/HomeView";
import { TerminalWorkspace } from "../../features/terminal/TerminalWorkspace";
import { SystemInfoView } from "../../features/monitor/SystemInfoView";
import { ProcessView } from "../../features/processes/ProcessView";
import { NetworkView } from "../../features/network/NetworkView";
import { TunnelView } from "../../features/tunnels/TunnelView";
import { ToolsDrawer } from "./ToolsDrawer";
import { IconButton } from "../common/IconButton";

export function Workspace() {
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const closeTab = useAppStore((state) => state.closeTab);
  const openConnectionManager = useAppStore((state) => state.openConnectionManager);

  return (
    <section className="workspace">
      <nav className="workspace-tabs">
        <button className={`home-tab ${activeTabId == null ? "active" : ""}`} type="button" title="连接列表" onClick={() => useAppStore.setState({ activeTabId: null })}>
          <Server size={17} />
        </button>
        <div className="session-tabs">
          {tabs.map((tab, index) => (
            <button key={tab.id} className={`session-tab ${tab.id === activeTabId ? "active" : ""}`} type="button" onClick={() => setActiveTab(tab.id)}>
              <span className={`session-status ${tab.state}`} />
              <strong>{index + 1} {tab.title}</strong>
              <span className="tab-close" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); void closeTab(tab.id); }}><X size={14} /></span>
            </button>
          ))}
        </div>
        <IconButton label="新建连接" className="new-tab-button" onClick={() => openConnectionManager(true)}><Plus size={19} /></IconButton>
      </nav>

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
            {tab.kind === "processes" && <ProcessView tab={tab} />}
            {tab.kind === "network" && <NetworkView tab={tab} />}
            {tab.kind === "tunnels" && <TunnelView tab={tab} />}
          </div>
        ))}
        <ToolsDrawer />
      </div>
    </section>
  );
}

