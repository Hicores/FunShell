import { useEffect, useState } from "react";
import { ChevronDown, Copy, Network, ServerCog } from "lucide-react";
import { api } from "../../lib/ipc";
import { formatBytes, formatDuration, formatRate } from "../../lib/format";
import { useAppStore } from "../../stores/appStore";
import { ProgressBar } from "../common/ProgressBar";
import { appendNetworkRateSample, NetworkRateChart, type NetworkRateSample } from "./NetworkRateChart";

export function ServerSidebar() {
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const snapshots = useAppStore((state) => state.snapshots);
  const setSnapshot = useAppStore((state) => state.setSnapshot);
  const openWorkspace = useAppStore((state) => state.openWorkspace);
  const connections = useAppStore((state) => state.connections);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const sessionTab = activeTab && tabs.find((tab) => tab.sessionId === activeTab.sessionId && tab.kind === "terminal");
  const sessionConnected = sessionTab?.state === "connected";
  const connection = connections.find((item) => item.id === sessionTab?.connectionId);
  const snapshot = sessionConnected ? snapshots[sessionTab.sessionId] : undefined;
  const [networkName, setNetworkName] = useState("eth0");
  const [networkHistory, setNetworkHistory] = useState<Record<string, NetworkRateSample[]>>({});
  const [latencies, setLatencies] = useState<Record<string, number>>({});
  const selectedNetwork = snapshot?.interfaces.find((item) => item.name === networkName) ?? snapshot?.interfaces[0];
  const networkHistoryKey = sessionTab && selectedNetwork ? `${sessionTab.sessionId}:${selectedNetwork.name}` : "";
  const latency = sessionTab ? latencies[sessionTab.sessionId] : undefined;

  useEffect(() => {
    const liveSessionIds = new Set(tabs.filter((tab) => tab.kind === "terminal").map((tab) => tab.sessionId));
    setNetworkHistory((current) => {
      if (!Object.keys(current).some((key) => !liveSessionIds.has(key.split(":", 1)[0]))) return current;
      return Object.fromEntries(Object.entries(current).filter(([key]) => liveSessionIds.has(key.split(":", 1)[0])));
    });
    setLatencies((current) => {
      if (!Object.keys(current).some((sessionId) => !liveSessionIds.has(sessionId))) return current;
      return Object.fromEntries(Object.entries(current).filter(([sessionId]) => liveSessionIds.has(sessionId)));
    });
  }, [tabs]);

  useEffect(() => {
    if (!sessionTab || !sessionConnected) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const [snapshotResult, latencyResult] = await Promise.allSettled([
        api.snapshot(sessionTab.sessionId),
        api.sessionLatency(sessionTab.sessionId),
      ]);
      refreshing = false;
      if (disposed) return;
      if (snapshotResult.status === "fulfilled") setSnapshot(sessionTab.sessionId, snapshotResult.value);
      if (latencyResult.status === "fulfilled") {
        setLatencies((current) => ({ ...current, [sessionTab.sessionId]: latencyResult.value }));
      } else {
        setLatencies((current) => {
          const next = { ...current };
          delete next[sessionTab.sessionId];
          return next;
        });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2200);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [sessionConnected, sessionTab?.sessionId, setSnapshot]);

  useEffect(() => {
    if (!sessionTab || !snapshot) return;
    const sampledAt = Date.now();
    setNetworkHistory((current) => {
      const next = { ...current };
      snapshot.interfaces.forEach((network) => {
        const key = `${sessionTab.sessionId}:${network.name}`;
        const sample: NetworkRateSample = { sampledAt, receiveBps: network.receiveBps, transmitBps: network.transmitBps };
        next[key] = appendNetworkRateSample(current[key] ?? [], sample);
      });
      return next;
    });
  }, [sessionTab?.sessionId, snapshot]);

  const memoryPercent = snapshot?.memoryTotal ? snapshot.memoryUsed / snapshot.memoryTotal * 100 : 0;
  const swapPercent = snapshot?.swapTotal ? snapshot.swapUsed / snapshot.swapTotal * 100 : 0;

  return (
    <aside className="server-sidebar">
      <div className="sidebar-block identity-block">
        <div className="ip-row">
          <span>IP</span><strong>{connection?.host ?? "-"}</strong>
          <button type="button" title="复制 IP" disabled={!connection} onClick={() => connection && void navigator.clipboard.writeText(connection.host)}><Copy size={13} /></button>
        </div>
        <button className="system-info-button" type="button" disabled={!sessionConnected} onClick={() => openWorkspace("system")}>
          <ServerCog size={15} />系统信息
        </button>
      </div>

      <div className="sidebar-block metrics-block">
        <div className="metric-line"><span>运行</span><strong>{snapshot ? formatDuration(snapshot.uptimeSeconds) : "-"}</strong></div>
        <div className="metric-line"><span>负载</span><strong>{snapshot ? snapshot.loadAverage.map((item) => item.toFixed(2)).join(", ") : "-"}</strong></div>
        <div className="resource-row"><span>CPU</span><ProgressBar value={snapshot?.cpuPercent ?? 0} label={`${snapshot?.cpuPercent.toFixed(0) ?? 0}%`} /></div>
        <div className="resource-row"><span>内存</span><ProgressBar value={memoryPercent} tone="orange" label={<><span>{memoryPercent.toFixed(0)}%</span><span className="resource-detail">{snapshot ? `${formatBytes(snapshot.memoryUsed)}/${formatBytes(snapshot.memoryTotal)}` : "0/0"}</span></>} /></div>
        <div className="resource-row"><span>交换</span><ProgressBar value={swapPercent} tone="orange" label={<><span>{swapPercent.toFixed(0)}%</span><span className="resource-detail">{snapshot ? `${formatBytes(snapshot.swapUsed)}/${formatBytes(snapshot.swapTotal)}` : "0/0"}</span></>} /></div>
      </div>

      <div
        className={`sidebar-block process-mini ${sessionConnected ? "clickable" : ""}`}
        role="button"
        tabIndex={sessionConnected ? 0 : -1}
        aria-label="打开进程管理"
        aria-disabled={!sessionConnected}
        onClick={() => sessionConnected && openWorkspace("processes")}
        onKeyDown={(event) => { if (sessionConnected && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openWorkspace("processes"); } }}
      >
        <div className="mini-table-head"><span>内存</span><span>CPU</span><span>命令</span></div>
        {(snapshot?.topProcesses ?? []).slice(0, 5).map((process) => (
          <div className="process-mini-row" key={process.pid}>
            <span>{formatBytes(process.memoryBytes, 0)}</span><span>{process.cpuPercent.toFixed(1)}</span><strong>{process.name}</strong>
          </div>
        ))}
        {!snapshot && <div className="mini-empty">连接后显示进程摘要</div>}
      </div>

      <div
        className={`sidebar-block network-mini ${sessionConnected ? "clickable" : ""}`}
        role="button"
        tabIndex={sessionConnected ? 0 : -1}
        aria-label="打开网络监听"
        aria-disabled={!sessionConnected}
        onClick={() => sessionConnected && openWorkspace("network")}
        onKeyDown={(event) => { if (sessionConnected && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openWorkspace("network"); } }}
      >
        <div className="network-summary">
          <span className="upload">↑ {formatRate(selectedNetwork?.transmitBps ?? 0)}</span>
          <span className="download">↓ {formatRate(selectedNetwork?.receiveBps ?? 0)}</span>
          <label>
            <select value={selectedNetwork?.name ?? networkName} onClick={(event) => event.stopPropagation()} onChange={(event) => setNetworkName(event.target.value)}>
              {(snapshot?.interfaces ?? [{ name: "eth0" }]).map((item) => <option key={item.name}>{item.name}</option>)}
            </select><ChevronDown size={13} />
          </label>
        </div>
        <NetworkRateChart samples={networkHistory[networkHistoryKey] ?? []} />
      </div>

      <button className="latency-block" type="button" disabled={!sessionConnected} title="SSH 数据往返延迟" onClick={() => openWorkspace("network")}>
        <Network size={15} /><strong>{latency == null ? "-" : `${latency} ms`}</strong><span>数据往返</span>
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
