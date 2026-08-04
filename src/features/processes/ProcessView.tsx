import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import type { ProcessDetails, ProcessInfo, ProcessSortKey, WorkspaceTab } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { ContextMenu } from "../../components/common/ContextMenu";
import { IconButton } from "../../components/common/IconButton";
import { SortableHeader } from "../../components/common/SortableHeader";
import { nextSortState, sortRows, type SortValue } from "../../lib/sort";
import { useVirtualRows, VirtualTableSpacer } from "../../components/common/useVirtualRows";

function processSortValue(process: ProcessInfo, key: ProcessSortKey): SortValue {
  return process[key];
}

export function mergeLiveProcessMetrics(processes: ProcessInfo[], liveProcesses: ProcessInfo[]) {
  const liveByPid = new Map(liveProcesses.map((process) => [process.pid, process]));
  const knownPids = new Set(processes.map((process) => process.pid));
  return [
    ...processes.map((process) => {
      const live = liveByPid.get(process.pid);
      return live ? { ...process, memoryBytes: live.memoryBytes, cpuPercent: live.cpuPercent } : process;
    }),
    ...liveProcesses.filter((process) => !knownPids.has(process.pid)),
  ];
}

export function ProcessView({ tab, active = true }: { tab: WorkspaceTab; active?: boolean }) {
  const notify = useAppStore((state) => state.notify);
  const snapshot = useAppStore((state) => state.snapshots[tab.sessionId]);
  const sort = useAppStore((state) => state.processSort);
  const setProcessSort = useAppStore((state) => state.setProcessSort);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [selected, setSelected] = useState<ProcessInfo | null>(null);
  const [details, setDetails] = useState<ProcessDetails | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<{ x: number; y: number; process: ProcessInfo } | null>(null);
  const refreshingRef = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setLoading(true);
    try { setProcesses(await api.processes(tab.sessionId)); }
    catch (error) { notify(String(error)); }
    finally { refreshingRef.current = false; setLoading(false); }
  }, [notify, tab.sessionId]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      await refresh();
      if (!disposed) timer = window.setTimeout(() => void poll(), 2200);
    };
    void poll();
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [active, refresh]);
  const choose = async (process: ProcessInfo) => { setSelected(process); try { setDetails(await api.processDetails(tab.sessionId, process.pid)); } catch (error) { notify(String(error)); } };
  const liveProcesses = useMemo(() => mergeLiveProcessMetrics(processes, snapshot?.topProcesses ?? []), [processes, snapshot?.topProcesses]);
  const filtered = useMemo(() => liveProcesses.filter((process) => `${process.pid} ${process.user} ${process.name} ${process.command}`.toLowerCase().includes(query.toLowerCase())), [liveProcesses, query]);
  const sortedProcesses = useMemo(() => sortRows(filtered, (process) => processSortValue(process, sort.key), sort.direction), [filtered, sort]);
  const virtualProcesses = useVirtualRows(sortedProcesses, 27);
  const sortProcesses = (key: ProcessSortKey, defaultDirection: "asc" | "desc") => {
    void setProcessSort(nextSortState(sort, key, defaultDirection));
  };
  const terminate = async (process: ProcessInfo | null, force: boolean) => {
    if (!process || !window.confirm(`${force ? "强制停止" : "终止"}进程 ${process.pid} ${process.name}？`)) return;
    if (force && !window.confirm(`强制停止会立即结束进程 ${process.pid}，未保存的数据可能丢失。再次确认？`)) return;
    try { await api.terminateProcess(tab.sessionId, process.pid, force); setSelected(null); setDetails(null); await refresh(); }
    catch (error) { notify(String(error)); }
  };
  return (
    <section className="detail-view process-view">
      <header className="view-toolbar"><strong>进程管理</strong><label><Search size={15} /><input placeholder="搜索 PID、用户、名称或命令" value={query} onChange={(event) => setQuery(event.target.value)} /></label><IconButton label="刷新" onClick={() => void refresh()}><RefreshCw size={16} className={loading ? "spin" : ""} /></IconButton></header>
      <div ref={virtualProcesses.containerRef} className="process-table-wrap"><table className="data-table process-table virtualized-table"><thead><tr>
        <SortableHeader label="PID" sortKey="pid" activeKey={sort.key} direction={sort.direction} onSort={sortProcesses} />
        <SortableHeader label="用户" sortKey="user" activeKey={sort.key} direction={sort.direction} onSort={sortProcesses} />
        <SortableHeader label="内存" sortKey="memoryBytes" activeKey={sort.key} direction={sort.direction} defaultDirection="desc" onSort={sortProcesses} />
        <SortableHeader label="CPU" sortKey="cpuPercent" activeKey={sort.key} direction={sort.direction} defaultDirection="desc" onSort={sortProcesses} />
        <SortableHeader label="名称/命令行" sortKey="name" activeKey={sort.key} direction={sort.direction} onSort={sortProcesses} />
      </tr></thead><tbody>
        <VirtualTableSpacer height={virtualProcesses.beforeHeight} columns={5} />
        {virtualProcesses.rows.map(({ item: process, index }) => <tr key={process.pid} className={`${selected?.pid === process.pid ? "selected " : ""}${index % 2 ? "virtual-even" : ""}`} onClick={() => void choose(process)} onContextMenu={(event) => { event.preventDefault(); setSelected(process); setContext({ x: event.clientX, y: event.clientY, process }); }}><td>{process.pid}</td><td>{process.user}</td><td>{formatBytes(process.memoryBytes)}</td><td>{process.cpuPercent.toFixed(1)}%</td><td><strong>{process.name}</strong><span>{process.command}</span></td></tr>)}
        <VirtualTableSpacer height={virtualProcesses.afterHeight} columns={5} />
      </tbody></table></div>
      <div className="process-details"><div><label>PID<input value={details?.pid ?? ""} readOnly /></label><label>名称<input value={details?.name ?? ""} readOnly /></label><label className="wide">位置<input value={details?.executable ?? ""} readOnly /></label><label className="wide">工作目录<input value={details?.workingDirectory ?? ""} readOnly /></label><textarea value={details?.command ?? "选择进程查看命令行和环境变量"} readOnly /></div><table className="data-table environment-table"><thead><tr><th>环境变量</th><th>值</th></tr></thead><tbody>{Object.entries(details?.environment ?? {}).map(([key, value]) => <tr key={key}><td>{key}</td><td>{value}</td></tr>)}</tbody></table></div>
      {context && <ContextMenu x={context.x} y={context.y} onClose={() => setContext(null)}><button type="button" onClick={() => void terminate(context.process, false)}>终止进程</button><button type="button" className="danger" onClick={() => void terminate(context.process, true)}>强制停止</button></ContextMenu>}
    </section>
  );
}
