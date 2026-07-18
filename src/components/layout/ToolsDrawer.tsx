import { Activity, Network, RadioTower, Route, Waypoints } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";

export function ToolsDrawer() {
  const open = useAppStore((state) => state.toolsOpen);
  const openWorkspace = useAppStore((state) => state.openWorkspace);
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const notify = useAppStore((state) => state.notify);
  const [target, setTarget] = useState("8.8.8.8");
  const [trace, setTrace] = useState("");
  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs.find((tab) => tab.kind === "terminal");

  const traceRoute = async () => {
    if (!active) return notify("请先连接服务器");
    try {
      const result = await api.traceRoute(active.sessionId, target, true);
      setTrace(result.output);
    } catch (error) {
      setTrace(String(error));
    }
  };

  if (!open) return null;
  return (
    <aside className="tools-drawer">
      <div className="route-input"><input value={target} onChange={(event) => setTarget(event.target.value)} /><button type="button" onClick={() => void traceRoute()}>路由追踪</button></div>
      <div className="tool-actions">
        <button type="button" onClick={() => void traceRoute()}><Route size={17} />路由追踪</button>
        <button type="button" onClick={() => openWorkspace("processes")}><Activity size={17} />进程管理</button>
        <button type="button" onClick={() => openWorkspace("network")}><Network size={17} />网络监控</button>
        <button type="button" onClick={() => openWorkspace("tunnels")}><Waypoints size={17} />隧道管理</button>
        <button type="button" onClick={() => notify("连接路线会在下次会话建立时自动测量并择优")}><RadioTower size={17} />自定义加速</button>
      </div>
      <div className="download-location"><span>下载: downloads</span></div>
      <pre className="trace-output">{trace || "路由追踪结果将在此处显示"}</pre>
    </aside>
  );
}
