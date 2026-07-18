import { RefreshCw, Search, Skull } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import type { ProcessDetails, ProcessInfo, WorkspaceTab } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { IconButton } from "../../components/common/IconButton";

export function ProcessView({ tab }: { tab: WorkspaceTab }) {
  const notify = useAppStore((state) => state.notify);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [selected, setSelected] = useState<ProcessInfo | null>(null);
  const [details, setDetails] = useState<ProcessDetails | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => { setLoading(true); try { setProcesses(await api.processes(tab.sessionId)); } catch (error) { notify(String(error)); } finally { setLoading(false); } }, [notify, tab.sessionId]);
  useEffect(() => { void refresh(); const timer = window.setInterval(refresh, 3200); return () => window.clearInterval(timer); }, [refresh]);
  const choose = async (process: ProcessInfo) => { setSelected(process); try { setDetails(await api.processDetails(tab.sessionId, process.pid)); } catch (error) { notify(String(error)); } };
  const filtered = useMemo(() => processes.filter((process) => `${process.pid} ${process.user} ${process.name} ${process.command}`.toLowerCase().includes(query.toLowerCase())), [processes, query]);
  const terminate = async (force: boolean) => {
    if (!selected || !window.confirm(`${force ? "强制终止" : "终止"}进程 ${selected.pid} ${selected.name}？`)) return;
    try { await api.terminateProcess(tab.sessionId, selected.pid, force); setSelected(null); setDetails(null); await refresh(); }
    catch (error) { notify(String(error)); }
  };
  return (
    <section className="detail-view process-view">
      <header className="view-toolbar"><strong>进程管理</strong><label><Search size={15} /><input placeholder="搜索 PID、用户、名称或命令" value={query} onChange={(event) => setQuery(event.target.value)} /></label><IconButton label="刷新" onClick={() => void refresh()}><RefreshCw size={16} className={loading ? "spin" : ""} /></IconButton><button className="danger-button" type="button" disabled={!selected} onClick={() => void terminate(false)}><Skull size={15} />终止</button><button className="danger-button ghost" type="button" disabled={!selected} onClick={() => void terminate(true)}>强制终止</button></header>
      <div className="process-table-wrap"><table className="data-table process-table"><thead><tr><th>PID</th><th>用户</th><th>内存</th><th>CPU</th><th>名称/命令行</th></tr></thead><tbody>{filtered.map((process) => <tr key={process.pid} className={selected?.pid === process.pid ? "selected" : ""} onClick={() => void choose(process)}><td>{process.pid}</td><td>{process.user}</td><td>{formatBytes(process.memoryBytes)}</td><td>{process.cpuPercent.toFixed(1)}%</td><td><strong>{process.name}</strong><span>{process.command}</span></td></tr>)}</tbody></table></div>
      <div className="process-details"><div><label>PID<input value={details?.pid ?? ""} readOnly /></label><label>名称<input value={details?.name ?? ""} readOnly /></label><label className="wide">位置<input value={details?.executable ?? ""} readOnly /></label><label className="wide">工作目录<input value={details?.workingDirectory ?? ""} readOnly /></label><textarea value={details?.command ?? "选择进程查看命令行和环境变量"} readOnly /></div><table className="data-table environment-table"><thead><tr><th>环境变量</th><th>值</th></tr></thead><tbody>{Object.entries(details?.environment ?? {}).map(([key, value]) => <tr key={key}><td>{key}</td><td>{value}</td></tr>)}</tbody></table></div>
    </section>
  );
}

