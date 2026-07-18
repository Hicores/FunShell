import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import type { SocketInfo, WorkspaceTab } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { IconButton } from "../../components/common/IconButton";

function address(socket: SocketInfo, local: boolean) {
  const host = local ? socket.localAddress : socket.remoteAddress;
  const port = local ? socket.localPort : socket.remotePort;
  return port ? `${host}:${port}` : host;
}

export function NetworkView({ tab }: { tab: WorkspaceTab }) {
  const notify = useAppStore((state) => state.notify);
  const [sockets, setSockets] = useState<SocketInfo[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SocketInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => { setLoading(true); try { setSockets(await api.sockets(tab.sessionId)); } catch (error) { notify(String(error)); } finally { setLoading(false); } }, [notify, tab.sessionId]);
  useEffect(() => { void refresh(); const timer = window.setInterval(refresh, 3000); return () => window.clearInterval(timer); }, [refresh]);
  const filtered = useMemo(() => sockets.filter((socket) => `${socket.pid} ${socket.process} ${address(socket, true)} ${address(socket, false)} ${socket.protocol}`.toLowerCase().includes(query.toLowerCase())), [query, sockets]);
  return (
    <section className="detail-view network-view">
      <header className="view-toolbar"><strong>网络监控</strong><label><Search size={15} /><input placeholder="搜索进程、IP 或端口" value={query} onChange={(event) => setQuery(event.target.value)} /></label><IconButton label="刷新" onClick={() => void refresh()}><RefreshCw size={16} className={loading ? "spin" : ""} /></IconButton></header>
      <div className="network-table-wrap"><table className="data-table"><thead><tr><th>PID</th><th>名称</th><th>协议</th><th>状态</th><th>监听/本地地址</th><th>远端地址</th><th>上传</th><th>下载</th></tr></thead><tbody>{filtered.map((socket, index) => <tr key={`${address(socket, true)}-${address(socket, false)}-${index}`} className={selected === socket ? "selected" : ""} onClick={() => setSelected(socket)}><td>{socket.pid ?? "-"}</td><td>{socket.process ?? "-"}</td><td>{socket.protocol}</td><td>{socket.state}</td><td>{address(socket, true)}</td><td>{address(socket, false)}</td><td>{socket.sentBytes == null ? "-" : formatBytes(socket.sentBytes)}</td><td>{socket.receivedBytes == null ? "-" : formatBytes(socket.receivedBytes)}</td></tr>)}</tbody></table></div>
      <div className="socket-details"><strong>{selected ? `${selected.process ?? "进程"} ${address(selected, true)}` : "选择连接查看明细"}</strong>{selected && <><span>远端 IP：{selected.remoteAddress}</span><span>连接状态：{selected.state}</span><span>IP 信息：{selected.remoteAddress === "127.0.0.1" || selected.remoteAddress === "::1" ? "本机地址" : "公网/远端地址"}</span></>}</div>
    </section>
  );
}
