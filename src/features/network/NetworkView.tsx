import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../../components/common/IconButton";
import { SortableHeader } from "../../components/common/SortableHeader";
import { formatBytes, formatRate } from "../../lib/format";
import { api } from "../../lib/ipc";
import { nextSortState, sortRows, type SortState, type SortValue } from "../../lib/sort";
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

type ListenerSortKey = "pid" | "process" | "protocol" | "addressFamily" | "interfaceName" | "localAddress" | "localPort" | "ipCount" | "connectionCount" | "sentBps" | "receivedBps";
type ConnectionSortKey = "interfaceName" | "localAddress" | "location" | "remoteAddress" | "remotePort" | "state" | "sentBps" | "receivedBps" | "sentBytes" | "receivedBytes";

function listenerSortValue(listener: ListenerInfo, key: ListenerSortKey): SortValue {
  if (key === "interfaceName") return interfaceText(listener.interfaceName);
  return listener[key];
}

function connectionSortValue(socket: RatedSocket, key: ConnectionSortKey, locations: Record<string, GeoIpInfo>, errors: Record<string, string>): SortValue {
  if (key === "location") return locationText(locations[socket.remoteAddress], errors[socket.remoteAddress]);
  return socket[key];
}

export function NetworkView({ tab }: { tab: WorkspaceTab }) {
  const notify = useAppStore((state) => state.notify);
  const [sockets, setSockets] = useState<RatedSocket[]>([]);
  const [query, setQuery] = useState("");
  const [familyFilter, setFamilyFilter] = useState("all");
  const [interfaceFilter, setInterfaceFilter] = useState("all");
  const [listenerSort, setListenerSort] = useState<SortState<ListenerSortKey>>({ key: "connectionCount", direction: "desc" });
  const [connectionSort, setConnectionSort] = useState<SortState<ConnectionSortKey> | null>(null);
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
  const sortedListeners = useMemo(() => sortRows(filtered, (listener) => listenerSortValue(listener, listenerSort.key), listenerSort.direction), [filtered, listenerSort]);
  const selected = listeners.find((listener) => listener.key === selectedKey) ?? null;
  const sortedConnections = useMemo(() => {
    const connections = selected?.connections ?? [];
    return connectionSort
      ? sortRows(connections, (socket) => connectionSortValue(socket, connectionSort.key, locations, locationErrors), connectionSort.direction)
      : connections;
  }, [connectionSort, locationErrors, locations, selected]);
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
  const sortListeners = (key: ListenerSortKey, defaultDirection: "asc" | "desc") => setListenerSort((current) => nextSortState(current, key, defaultDirection));
  const sortConnections = (key: ConnectionSortKey, defaultDirection: "asc" | "desc") => setConnectionSort((current) => nextSortState(current, key, defaultDirection));

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
          <thead><tr>
            <SortableHeader label="PID" sortKey="pid" activeKey={listenerSort.key} direction={listenerSort.direction} onSort={sortListeners} />
            <SortableHeader label="名称" sortKey="process" activeKey={listenerSort.key} direction={listenerSort.direction} onSort={sortListeners} />
            <SortableHeader label="协议" sortKey="protocol" activeKey={listenerSort.key} direction={listenerSort.direction} onSort={sortListeners} />
            <SortableHeader label="IP 版本" sortKey="addressFamily" activeKey={listenerSort.key} direction={listenerSort.direction} onSort={sortListeners} />
            <SortableHeader label="网卡" sortKey="interfaceName" activeKey={listenerSort.key} direction={listenerSort.direction} onSort={sortListeners} />
            <SortableHeader label="监听 IP" sortKey="localAddress" activeKey={listenerSort.key} direction={listenerSort.direction} onSort={sortListeners} />
            <SortableHeader label="端口" sortKey="localPort" activeKey={listenerSort.key} direction={listenerSort.direction} onSort={sortListeners} />
            <SortableHeader label="IP 数" sortKey="ipCount" activeKey={listenerSort.key} direction={listenerSort.direction} defaultDirection="desc" onSort={sortListeners} />
            <SortableHeader label="连接数" sortKey="connectionCount" activeKey={listenerSort.key} direction={listenerSort.direction} defaultDirection="desc" onSort={sortListeners} />
            <SortableHeader label="上传速率" sortKey="sentBps" activeKey={listenerSort.key} direction={listenerSort.direction} defaultDirection="desc" onSort={sortListeners} />
            <SortableHeader label="下载速率" sortKey="receivedBps" activeKey={listenerSort.key} direction={listenerSort.direction} defaultDirection="desc" onSort={sortListeners} />
          </tr></thead>
          <tbody>{sortedListeners.map((listener) => (
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
            <thead><tr>
              <SortableHeader label="网卡" sortKey="interfaceName" activeKey={connectionSort?.key} direction={connectionSort?.direction} onSort={sortConnections} />
              <SortableHeader label="本地 IP" sortKey="localAddress" activeKey={connectionSort?.key} direction={connectionSort?.direction} onSort={sortConnections} />
              <SortableHeader label="位置" sortKey="location" activeKey={connectionSort?.key} direction={connectionSort?.direction} onSort={sortConnections} />
              <SortableHeader label="远端 IP" sortKey="remoteAddress" activeKey={connectionSort?.key} direction={connectionSort?.direction} onSort={sortConnections} />
              <SortableHeader label="端口" sortKey="remotePort" activeKey={connectionSort?.key} direction={connectionSort?.direction} onSort={sortConnections} />
              <SortableHeader label="状态" sortKey="state" activeKey={connectionSort?.key} direction={connectionSort?.direction} onSort={sortConnections} />
              <SortableHeader label="上传速率" sortKey="sentBps" activeKey={connectionSort?.key} direction={connectionSort?.direction} defaultDirection="desc" onSort={sortConnections} />
              <SortableHeader label="下载速率" sortKey="receivedBps" activeKey={connectionSort?.key} direction={connectionSort?.direction} defaultDirection="desc" onSort={sortConnections} />
              <SortableHeader label="累计上传" sortKey="sentBytes" activeKey={connectionSort?.key} direction={connectionSort?.direction} defaultDirection="desc" onSort={sortConnections} />
              <SortableHeader label="累计下载" sortKey="receivedBytes" activeKey={connectionSort?.key} direction={connectionSort?.direction} defaultDirection="desc" onSort={sortConnections} />
            </tr></thead>
            <tbody>{sortedConnections.map((socket) => (
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
