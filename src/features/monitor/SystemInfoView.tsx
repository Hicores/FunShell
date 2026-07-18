import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import { formatBytes, formatDuration, formatRate } from "../../lib/format";
import type { SystemInfo, WorkspaceTab } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { ProgressBar } from "../../components/common/ProgressBar";
import { IconButton } from "../../components/common/IconButton";

export function SystemInfoView({ tab }: { tab: WorkspaceTab }) {
  const notify = useAppStore((state) => state.notify);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setInfo(await api.systemInfo(tab.sessionId)); }
    catch (error) { notify(String(error)); }
    finally { setLoading(false); }
  }, [notify, tab.sessionId]);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!info) return <div className="view-loading"><RefreshCw className={loading ? "spin" : ""} />正在读取系统信息</div>;
  const snapshot = info.snapshot;
  const memory = snapshot.memoryTotal ? snapshot.memoryUsed / snapshot.memoryTotal * 100 : 0;
  const swap = snapshot.swapTotal ? snapshot.swapUsed / snapshot.swapTotal * 100 : 0;
  return (
    <section className="detail-view system-info-view">
      <header className="view-toolbar"><strong>系统信息</strong><span>{info.hostname}</span><IconButton label="刷新" onClick={() => void refresh()}><RefreshCw size={16} className={loading ? "spin" : ""} /></IconButton></header>
      <div className="system-grid">
        <dl><dt>操作系统</dt><dd>{info.operatingSystem}</dd><dt>内核</dt><dd>{info.kernel}</dd><dt>内核版本</dt><dd>{info.kernelVersion}</dd><dt>硬件架构</dt><dd>{info.architecture}</dd><dt>主机名称</dt><dd>{info.hostname}</dd><dt>运行时间</dt><dd>{formatDuration(snapshot.uptimeSeconds)}</dd></dl>
        <div className="system-section"><h3>CPU</h3><div className="spec-row"><span>名称</span><strong>{info.cpuModel}</strong><span>核心数</span><strong>{info.cpuCores}</strong><span>频率</span><strong>{info.cpuFrequencyMhz?.toFixed(1) ?? "-"} MHz</strong><span>缓存</span><strong>{info.cache ?? "-"}</strong></div><div className="usage-grid"><span>CPU 占用</span><ProgressBar value={snapshot.cpuPercent} /><strong>{snapshot.cpuPercent.toFixed(1)}%</strong><span>负载</span><strong>{snapshot.loadAverage.map((item) => item.toFixed(2)).join(" / ")}</strong></div></div>
        <div className="system-section memory-section"><h3>内存</h3><div><span>{formatBytes(snapshot.memoryTotal)}</span><ProgressBar value={memory} tone="orange" /><strong>已使用 {formatBytes(snapshot.memoryUsed)} ({memory.toFixed(1)}%)</strong></div><div><span>交换 {formatBytes(snapshot.swapTotal)}</span><ProgressBar value={swap} tone="orange" /><strong>已使用 {formatBytes(snapshot.swapUsed)} ({swap.toFixed(1)}%)</strong></div></div>
        <div className="system-section"><h3>网络接口</h3><table className="data-table"><thead><tr><th>名称</th><th>发送</th><th>接收</th><th>发送速度</th><th>接收速度</th></tr></thead><tbody>{snapshot.interfaces.map((item) => <tr key={item.name}><td>{item.name}</td><td>{formatBytes(item.transmittedBytes)}</td><td>{formatBytes(item.receivedBytes)}</td><td>{formatRate(item.transmitBps)}</td><td>{formatRate(item.receiveBps)}</td></tr>)}</tbody></table></div>
        <div className="system-section"><h3>文件系统</h3><table className="data-table"><thead><tr><th>名称</th><th>大小</th><th>已用</th><th>占用</th><th>可用</th><th>挂载点</th></tr></thead><tbody>{snapshot.filesystems.map((item) => <tr key={`${item.device}-${item.mountPoint}`}><td>{item.device}</td><td>{formatBytes(item.total)}</td><td>{formatBytes(item.used)}</td><td>{item.usagePercent.toFixed(1)}%</td><td>{formatBytes(item.available)}</td><td>{item.mountPoint}</td></tr>)}</tbody></table></div>
      </div>
    </section>
  );
}

