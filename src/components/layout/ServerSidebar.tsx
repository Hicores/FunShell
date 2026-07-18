import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Copy, Network, ServerCog } from "lucide-react";
import { api } from "../../lib/ipc";
import { formatBytes, formatDuration, formatRate } from "../../lib/format";
import { useAppStore } from "../../stores/appStore";
import { ProgressBar } from "../common/ProgressBar";

export function ServerSidebar() {
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const snapshots = useAppStore((state) => state.snapshots);
  const setSnapshot = useAppStore((state) => state.setSnapshot);
  const openWorkspace = useAppStore((state) => state.openWorkspace);
  const connections = useAppStore((state) => state.connections);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const sessionTab = activeTab && tabs.find((tab) => tab.sessionId === activeTab.sessionId && tab.kind === "terminal");
  const connection = connections.find((item) => item.id === sessionTab?.connectionId);
  const snapshot = sessionTab ? snapshots[sessionTab.sessionId] : undefined;
  const [networkName, setNetworkName] = useState("eth0");
  const selectedNetwork = snapshot?.interfaces.find((item) => item.name === networkName) ?? snapshot?.interfaces[0];

  useEffect(() => {
    if (!sessionTab) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await api.snapshot(sessionTab.sessionId);
        if (!disposed) setSnapshot(sessionTab.sessionId, next);
      } catch {
        // Session status already surfaces connection errors.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2200);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [sessionTab?.sessionId, setSnapshot]);

  const networkBars = useMemo(() => {
    const base = selectedNetwork ? Math.max(selectedNetwork.receiveBps, selectedNetwork.transmitBps, 1) : 1;
    return Array.from({ length: 22 }, (_, index) => {
      const wave = 0.2 + Math.abs(Math.sin(index * 1.91 + base / 100000)) * 0.7;
      return Math.max(4, Math.round(wave * 56));
    });
  }, [selectedNetwork?.receiveBps, selectedNetwork?.transmitBps]);

  const memoryPercent = snapshot?.memoryTotal ? snapshot.memoryUsed / snapshot.memoryTotal * 100 : 0;
  const swapPercent = snapshot?.swapTotal ? snapshot.swapUsed / snapshot.swapTotal * 100 : 0;

  return (
    <aside className="server-sidebar">
      <div className="sidebar-block identity-block">
        <div className="sync-row"><span>同步状态</span><span className={`status-dot ${connection ? "online" : ""}`} /></div>
        <div className="ip-row">
          <span>IP</span><strong>{connection?.host ?? "-"}</strong>
          <button type="button" title="复制 IP" disabled={!connection} onClick={() => connection && void navigator.clipboard.writeText(connection.host)}><Copy size={13} /></button>
        </div>
        <button className="system-info-button" type="button" disabled={!sessionTab} onClick={() => openWorkspace("system")}>
          <ServerCog size={15} />系统信息
        </button>
      </div>

      <div className="sidebar-block metrics-block">
        <div className="metric-line"><span>运行</span><strong>{snapshot ? formatDuration(snapshot.uptimeSeconds) : "-"}</strong></div>
        <div className="metric-line"><span>负载</span><strong>{snapshot ? snapshot.loadAverage.map((item) => item.toFixed(2)).join(", ") : "-"}</strong></div>
        <div className="resource-row"><span>CPU</span><ProgressBar value={snapshot?.cpuPercent ?? 0} /><em>{snapshot?.cpuPercent.toFixed(0) ?? 0}%</em></div>
        <div className="resource-row"><span>内存</span><ProgressBar value={memoryPercent} tone="orange" /><em>{snapshot ? `${formatBytes(snapshot.memoryUsed)}/${formatBytes(snapshot.memoryTotal)}` : "0/0"}</em></div>
        <div className="resource-row"><span>交换</span><ProgressBar value={swapPercent} tone="orange" /><em>{snapshot ? `${formatBytes(snapshot.swapUsed)}/${formatBytes(snapshot.swapTotal)}` : "0/0"}</em></div>
      </div>

      <div className="sidebar-block process-mini">
        <div className="mini-table-head"><span>内存</span><span>CPU</span><span>命令</span></div>
        {(snapshot?.topProcesses ?? []).slice(0, 5).map((process) => (
          <button key={process.pid} type="button" onDoubleClick={() => openWorkspace("processes")}>
            <span>{formatBytes(process.memoryBytes, 0)}</span><span>{process.cpuPercent.toFixed(1)}</span><strong>{process.name}</strong>
          </button>
        ))}
        {!snapshot && <div className="mini-empty">连接后显示进程摘要</div>}
      </div>

      <div className="sidebar-block network-mini">
        <div className="network-summary">
          <span className="upload">↑ {formatRate(selectedNetwork?.transmitBps ?? 0)}</span>
          <span className="download">↓ {formatRate(selectedNetwork?.receiveBps ?? 0)}</span>
          <label>
            <select value={selectedNetwork?.name ?? networkName} onChange={(event) => setNetworkName(event.target.value)}>
              {(snapshot?.interfaces ?? [{ name: "eth0" }]).map((item) => <option key={item.name}>{item.name}</option>)}
            </select><ChevronDown size={13} />
          </label>
        </div>
        <div className="network-chart" aria-label="网卡速度图">
          {networkBars.map((height, index) => <i key={index} style={{ height }} />)}
        </div>
      </div>

      <button className="latency-block" type="button" onClick={() => openWorkspace("network")}>
        <Network size={15} /><strong>0 ms</strong><span>本机</span>
      </button>

      <div className="filesystem-list">
        <div className="filesystem-head"><span>路径</span><span>可用/大小</span></div>
        {(snapshot?.filesystems ?? []).map((filesystem) => (
          <div key={`${filesystem.device}-${filesystem.mountPoint}`} className="filesystem-row">
            <span>{filesystem.mountPoint}</span>
            <span>{formatBytes(filesystem.available)}/{formatBytes(filesystem.total)}</span>
            <i style={{ width: `${filesystem.usagePercent}%` }} />
          </div>
        ))}
      </div>

      <footer className="sidebar-footer">FunShell 0.1.0</footer>
    </aside>
  );
}
