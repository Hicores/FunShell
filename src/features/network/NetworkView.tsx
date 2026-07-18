import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../../components/common/IconButton";
import { formatBytes, formatRate } from "../../lib/format";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { GeoIpInfo, SocketInfo, WorkspaceTab } from "../../types";
import { buildListeners, rateSocketSamples, socketKey, type ListenerInfo, type RatedSocket } from "./networkModel";

function endpoint(host: string, port: number | null) {
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return port == null ? formattedHost : `${formattedHost}:${port}`;
}

function rate(value: number | null) {
  return value == null ? "-" : formatRate(value);
}

function interfaceText(name: string | null) {
  return name ?? "全部网卡";
}

function locationText(info: GeoIpInfo | undefined, error: string | undefined) {
  if (info?.private) return "私网/本地地址";
  if (info) return [info.country, info.region, info.city, info.isp].filter(Boolean).join(" · ") || "位置未知";
  return error ? "查询不可用" : "查询中...";
}

export function NetworkView({ tab }: { tab: WorkspaceTab }) {
  const notify = useAppStore((state) => state.notify);
  const [sockets, setSockets] = useState<RatedSocket[]>([]);
  const [query, setQuery] = useState("");
  const [familyFilter, setFamilyFilter] = useState("all");
  const [interfaceFilter, setInterfaceFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [locations, setLocations] = useState<Record<string, GeoIpInfo>>({});
  const [locationErrors, setLocationErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const previousRef = useRef<Map<string, SocketInfo>>(new Map());
  const sampledAtRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.sockets(tab.sessionId);
      const now = Date.now();
      const elapsed = sampledAtRef.current == null ? 3_000 : Math.max(250, now - sampledAtRef.current);
      setSockets(rateSocketSamples(next, previousRef.current, elapsed));
      previousRef.current = new Map(next.map((socket) => [socketKey(socket), socket]));
      sampledAtRef.current = now;
    } catch (error) {
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [notify, tab.sessionId]);

  useEffect(() => {
    previousRef.current.clear();
    sampledAtRef.current = null;
    void refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const listeners = useMemo(() => buildListeners(sockets), [sockets]);
  const interfaceOptions = useMemo(() => [...new Set(listeners.flatMap((listener) => [listener.interfaceName, ...listener.connections.map((socket) => socket.interfaceName)]).filter((name): name is string => Boolean(name)))].sort(), [listeners]);
  const filtered = useMemo(() => {
    const value = query.toLowerCase();
    return listeners.filter((listener) => {
      const matchesFamily = familyFilter === "all" || listener.addressFamily === familyFilter;
      const matchesInterface = interfaceFilter === "all"
        || (interfaceFilter === "wildcard"
          ? listener.interfaceName == null
          : listener.interfaceName === interfaceFilter || listener.connections.some((socket) => socket.interfaceName === interfaceFilter));
      const matchesQuery = `${listener.pid} ${listener.process} ${listener.protocol} ${listener.addressFamily} ${interfaceText(listener.interfaceName)} ${listener.localAddress} ${listener.localPort}`.toLowerCase().includes(value);
      return matchesFamily && matchesInterface && matchesQuery;
    });
  }, [familyFilter, interfaceFilter, listeners, query]);
  const selected = listeners.find((listener) => listener.key === selectedKey) ?? null;
  const remoteIpKey = useMemo(() => selected
    ? [...new Set(selected.connections.map((socket) => socket.remoteAddress).filter(Boolean))].sort().join("|")
    : "", [selected]);

  useEffect(() => {
    if (!remoteIpKey) return;
    let disposed = false;
    const ips = remoteIpKey.split("|");
    void Promise.all(ips.map(async (ip) => {
      try { return { ip, info: await api.geoIp(ip), error: null }; }
      catch (error) { return { ip, info: null, error: String(error) }; }
    })).then((results) => {
      if (disposed) return;
      setLocations((current) => {
        const next = { ...current };
        results.forEach((result) => { if (result.info) next[result.ip] = result.info; });
        return next;
      });
      setLocationErrors((current) => {
        const next = { ...current };
        results.forEach((result) => { if (result.error) next[result.ip] = result.error; });
        return next;
      });
    });
    return () => { disposed = true; };
  }, [remoteIpKey]);

  const choose = (listener: ListenerInfo) => setSelectedKey(listener.key);

  return (
    <section className="detail-view network-view">
      <header className="view-toolbar">
        <strong>网络监听</strong>
        <span>{listeners.length} 个监听端口 · 每 2 秒采样速率</span>
        <select className="network-filter" aria-label="筛选 IP 版本" value={familyFilter} onChange={(event) => setFamilyFilter(event.target.value)}><option value="all">全部 IP</option><option value="IPv4">IPv4</option><option value="IPv6">IPv6</option></select>
        <select className="network-filter interface-filter" aria-label="筛选网卡" value={interfaceFilter} onChange={(event) => setInterfaceFilter(event.target.value)}><option value="all">全部网卡范围</option><option value="wildcard">监听全部网卡</option>{interfaceOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <label><Search size={15} /><input placeholder="搜索程序、PID、IP、网卡或端口" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <IconButton label="刷新" onClick={() => void refresh()}><RefreshCw size={16} className={loading ? "spin" : ""} /></IconButton>
      </header>

      <div className="network-listener-table-wrap">
        <table className="data-table listener-table">
          <thead><tr><th>PID</th><th>名称</th><th>协议</th><th>IP 版本</th><th>网卡</th><th>监听 IP</th><th>端口</th><th>IP 数</th><th>连接数</th><th>上传速率</th><th>下载速率</th></tr></thead>
          <tbody>{filtered.map((listener) => (
            <tr key={listener.key} className={selectedKey === listener.key ? "selected" : ""} onClick={() => choose(listener)}>
              <td>{listener.pid ?? "-"}</td><td>{listener.process ?? "未知程序"}</td><td>{listener.protocol.toUpperCase()}</td><td>{listener.addressFamily}</td><td>{interfaceText(listener.interfaceName)}</td><td>{listener.localAddress}</td><td>{listener.localPort}</td><td>{listener.ipCount}</td><td>{listener.connectionCount}</td><td>{rate(listener.sentBps)}</td><td>{rate(listener.receivedBps)}</td>
            </tr>
          ))}</tbody>
        </table>
        {!filtered.length && <div className="empty-state">当前没有匹配的监听端口</div>}
      </div>

      <section className="listener-connections">
        <header><strong>{selected ? endpoint(selected.localAddress, selected.localPort) : "连接明细"}</strong><span>{selected ? `${selected.process ?? "未知程序"} · ${selected.addressFamily} · ${interfaceText(selected.interfaceName)} · ${selected.connectionCount} 个连接` : "选择上方监听程序查看连接"}</span></header>
        <div className="listener-connections-table-wrap">
          <table className="data-table listener-connections-table">
            <thead><tr><th>网卡</th><th>本地 IP</th><th>位置</th><th>远端 IP</th><th>端口</th><th>状态</th><th>上传速率</th><th>下载速率</th><th>累计上传</th><th>累计下载</th></tr></thead>
            <tbody>{(selected?.connections ?? []).map((socket) => (
              <tr key={socket.key}><td>{socket.interfaceName ?? "-"}</td><td>{socket.localAddress}</td><td title={locationErrors[socket.remoteAddress]}>{locationText(locations[socket.remoteAddress], locationErrors[socket.remoteAddress])}</td><td>{socket.remoteAddress}</td><td>{socket.remotePort ?? "-"}</td><td>{socket.state}</td><td>{rate(socket.sentBps)}</td><td>{rate(socket.receivedBps)}</td><td>{socket.sentBytes == null ? "-" : formatBytes(socket.sentBytes)}</td><td>{socket.receivedBytes == null ? "-" : formatBytes(socket.receivedBytes)}</td></tr>
            ))}</tbody>
          </table>
          {selected && !selected.connections.length && <div className="empty-state">该监听端口当前没有活动连接</div>}
          {!selected && <div className="empty-state">点击监听程序后在这里查看连接速率与 IP 信息</div>}
        </div>
      </section>
    </section>
  );
}
