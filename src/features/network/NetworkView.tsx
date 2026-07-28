import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../../components/common/IconButton";
import { SortableHeader } from "../../components/common/SortableHeader";
import { formatBytes, formatRate } from "../../lib/format";
import { api } from "../../lib/ipc";
import { nextSortState, sortRows, type SortState, type SortValue } from "../../lib/sort";
import { useAppStore } from "../../stores/appStore";
import type { GeoIpInfo, SocketInfo, SocketListenerSummary, WorkspaceTab } from "../../types";
import { useVirtualRows, VirtualTableSpacer } from "../../components/common/useVirtualRows";
import { buildListeners, rateSocketSamples, socketKey, type ListenerInfo, type RatedSocket } from "./networkModel";

const GEO_IP_CACHE_LIMIT = 256;
const GEO_IP_CONCURRENCY = 6;

interface GeoIpLookupResult {
  ip: string;
  info: GeoIpInfo | null;
  error: string | null;
}

export function mergeBoundedRecord<T>(current: Record<string, T>, additions: Array<[string, T]>, limit = GEO_IP_CACHE_LIMIT) {
  const entries = new Map(Object.entries(current));
  additions.forEach(([key, value]) => {
    entries.delete(key);
    entries.set(key, value);
  });
  while (entries.size > limit) {
    const oldest = entries.keys().next().value;
    if (oldest == null) break;
    entries.delete(oldest);
  }
  return Object.fromEntries(entries);
}

export async function lookupGeoIps(
  ips: string[],
  onResult: (result: GeoIpLookupResult) => void,
  lookup: (ip: string) => Promise<GeoIpInfo> = api.geoIp,
) {
  const results = new Array<GeoIpLookupResult>(ips.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < ips.length) {
      const index = nextIndex++;
      const ip = ips[index];
      try { results[index] = { ip, info: await lookup(ip), error: null }; }
      catch (error) { results[index] = { ip, info: null, error: String(error) }; }
      onResult(results[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(GEO_IP_CONCURRENCY, ips.length) }, worker));
  return results;
}

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

export function NetworkView({ tab, active = true }: { tab: WorkspaceTab; active?: boolean }) {
  const notify = useAppStore((state) => state.notify);
  const [listenerSockets, setListenerSockets] = useState<RatedSocket[]>([]);
  const [listenerSummaries, setListenerSummaries] = useState<SocketListenerSummary[]>([]);
  const [connectionSockets, setConnectionSockets] = useState<RatedSocket[]>([]);
  const [query, setQuery] = useState("");
  const [familyFilter, setFamilyFilter] = useState("all");
  const [interfaceFilter, setInterfaceFilter] = useState("all");
  const [listenerSort, setListenerSort] = useState<SortState<ListenerSortKey>>({ key: "connectionCount", direction: "desc" });
  const [connectionSort, setConnectionSort] = useState<SortState<ConnectionSortKey> | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailsLoadedKey, setDetailsLoadedKey] = useState<string | null>(null);
  const [locations, setLocations] = useState<Record<string, GeoIpInfo>>({});
  const [locationErrors, setLocationErrors] = useState<Record<string, string>>({});
  const [listenerLoading, setListenerLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailPreviousRef = useRef<Map<string, SocketInfo>>(new Map());
  const detailSampledAtRef = useRef<number | null>(null);
  const listenerRefreshingRef = useRef(false);
  const detailRefreshingRef = useRef(false);
  const selectedRef = useRef<ListenerInfo | null>(null);
  const activeRef = useRef(active);
  const pendingGeoIpsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  activeRef.current = active;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refreshListeners = useCallback(async () => {
    if (listenerRefreshingRef.current) return;
    listenerRefreshingRef.current = true;
    setListenerLoading(true);
    try {
      const next = await api.socketListeners(tab.sessionId);
      if (mountedRef.current && activeRef.current) {
        setListenerSockets(rateSocketSamples(next.listeners, new Map(), 1_000));
        setListenerSummaries(next.summaries);
      }
    } catch (error) {
      notify(String(error));
    } finally {
      listenerRefreshingRef.current = false;
      if (mountedRef.current) setListenerLoading(false);
    }
  }, [notify, tab.sessionId]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      await refreshListeners();
      if (!disposed) timer = window.setTimeout(() => void poll(), 1_000);
    };
    void poll();
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [active, refreshListeners]);

  const listeners = useMemo(() => buildListeners([...listenerSockets, ...connectionSockets], listenerSummaries), [connectionSockets, listenerSockets, listenerSummaries]);
  const interfaceOptions = useMemo(() => [...new Set(listeners.flatMap((listener) => [listener.interfaceName, ...listener.connections.map((socket) => socket.interfaceName)]).filter((name): name is string => Boolean(name)))].sort(), [listeners]);
  const filtered = useMemo(() => {
    const value = query.toLowerCase();
    return listeners.filter((listener) => {
      const matchesFamily = familyFilter === "all" || listener.addressFamilies.includes(familyFilter);
      const matchesInterface = interfaceFilter === "all"
        || (interfaceFilter === "wildcard"
          ? listener.interfaceName == null
          : listener.interfaceName === interfaceFilter || listener.connections.some((socket) => socket.interfaceName === interfaceFilter));
      const matchesQuery = `${listener.pids.join(" ")} ${listener.process} ${listener.protocol} ${listener.addressFamily} ${interfaceText(listener.interfaceName)} ${listener.localAddresses.join(" ")} ${listener.localPort}`.toLowerCase().includes(value);
      return matchesFamily && matchesInterface && matchesQuery;
    });
  }, [familyFilter, interfaceFilter, listeners, query]);
  const sortedListeners = useMemo(() => sortRows(filtered, (listener) => listenerSortValue(listener, listenerSort.key), listenerSort.direction), [filtered, listenerSort]);
  const virtualListeners = useVirtualRows(sortedListeners, 27);
  const selected = listeners.find((listener) => listener.key === selectedKey) ?? null;
  selectedRef.current = selected;

  const refreshConnections = useCallback(async () => {
    const target = selectedRef.current;
    if (!target || detailRefreshingRef.current) return;
    const targetKey = target.key;
    detailRefreshingRef.current = true;
    setDetailLoading(true);
    try {
      const next = (await Promise.all(target.addressFamilies.map((addressFamily) => api.socketConnections(tab.sessionId, target.protocol, addressFamily, target.localPort)))).flat();
      if (!mountedRef.current || !activeRef.current || selectedRef.current?.key !== targetKey) return;
      const now = Date.now();
      const elapsed = detailSampledAtRef.current == null ? 2_000 : Math.max(250, now - detailSampledAtRef.current);
      setConnectionSockets(rateSocketSamples(next, detailPreviousRef.current, elapsed));
      detailPreviousRef.current = new Map(next.map((socket) => [socketKey(socket), socket]));
      detailSampledAtRef.current = now;
      setDetailsLoadedKey(targetKey);
    } catch (error) {
      notify(String(error));
    } finally {
      detailRefreshingRef.current = false;
      if (mountedRef.current) setDetailLoading(false);
    }
  }, [notify, tab.sessionId]);

  useEffect(() => {
    if (!selectedKey) {
      setConnectionSockets([]);
      setDetailsLoadedKey(null);
      return;
    }
    if (!active) return;
    detailPreviousRef.current.clear();
    detailSampledAtRef.current = null;
    setConnectionSockets([]);
    setDetailsLoadedKey(null);
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      await refreshConnections();
      if (!disposed) timer = window.setTimeout(() => void poll(), 2_000);
    };
    void poll();
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [active, refreshConnections, selectedKey]);

  useEffect(() => {
    if (selectedKey && !selected) setSelectedKey(null);
  }, [selected, selectedKey]);

  const sortedConnections = useMemo(() => {
    const connections = selected?.connections ?? [];
    return connectionSort
      ? sortRows(connections, (socket) => connectionSortValue(socket, connectionSort.key, locations, locationErrors), connectionSort.direction)
      : connections;
  }, [connectionSort, locationErrors, locations, selected]);
  const virtualConnections = useVirtualRows(sortedConnections, 27);
  const visibleRemoteIpKey = useMemo(() => [...new Set(virtualConnections.rows.map(({ item }) => item.remoteAddress).filter(Boolean))].sort().join("|"), [virtualConnections.rows]);

  useEffect(() => {
    if (!active || !visibleRemoteIpKey) return;
    const ips = visibleRemoteIpKey
      .split("|")
      .filter((ip) => !locations[ip] && !locationErrors[ip] && !pendingGeoIpsRef.current.has(ip));
    if (!ips.length) return;
    ips.forEach((ip) => pendingGeoIpsRef.current.add(ip));
    void lookupGeoIps(ips, (result) => {
      pendingGeoIpsRef.current.delete(result.ip);
      if (!mountedRef.current) return;
      if (result.info) {
        setLocations((current) => mergeBoundedRecord(current, [[result.ip, result.info!]]));
      } else if (result.error) {
        setLocationErrors((current) => mergeBoundedRecord(current, [[result.ip, result.error!]]));
      }
    });
  }, [active, locationErrors, locations, tab.sessionId, visibleRemoteIpKey]);

  useEffect(() => {
    setListenerSockets([]);
    setListenerSummaries([]);
    setConnectionSockets([]);
    setSelectedKey(null);
    setDetailsLoadedKey(null);
    detailPreviousRef.current.clear();
    detailSampledAtRef.current = null;
    setLocations({});
    setLocationErrors({});
  }, [tab.sessionId]);

  const choose = (listener: ListenerInfo) => {
    if (listener.key === selectedKey) return;
    setConnectionSockets([]);
    setDetailsLoadedKey(null);
    setSelectedKey(listener.key);
  };
  const refresh = () => Promise.all([refreshListeners(), refreshConnections()]);
  const loading = listenerLoading || detailLoading;
  const sortListeners = (key: ListenerSortKey, defaultDirection: "asc" | "desc") => setListenerSort((current) => nextSortState(current, key, defaultDirection));
  const sortConnections = (key: ConnectionSortKey, defaultDirection: "asc" | "desc") => setConnectionSort((current) => nextSortState(current, key, defaultDirection));

  return (
    <section className="detail-view network-view">
      <header className="view-toolbar">
        <strong>网络监听</strong>
        <span>{listeners.length} 个监听端口</span>
        <select className="network-filter" aria-label="筛选 IP 版本" value={familyFilter} onChange={(event) => setFamilyFilter(event.target.value)}><option value="all">全部 IP</option><option value="IPv4">IPv4</option><option value="IPv6">IPv6</option></select>
        <select className="network-filter interface-filter" aria-label="筛选网卡" value={interfaceFilter} onChange={(event) => setInterfaceFilter(event.target.value)}><option value="all">全部网卡范围</option><option value="wildcard">监听全部网卡</option>{interfaceOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <label><Search size={15} /><input placeholder="搜索程序、PID、IP、网卡或端口" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <IconButton label="刷新" onClick={() => void refresh()}><RefreshCw size={16} className={loading ? "spin" : ""} /></IconButton>
      </header>

      <div ref={virtualListeners.containerRef} className="network-listener-table-wrap">
        <table className="data-table listener-table virtualized-table">
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
          <tbody>
            <VirtualTableSpacer height={virtualListeners.beforeHeight} columns={11} />
            {virtualListeners.rows.map(({ item: listener, index }) => (
            <tr key={listener.key} className={`${selectedKey === listener.key ? "selected " : ""}${index % 2 ? "virtual-even" : ""}`} onClick={() => choose(listener)}>
              <td title={listener.pids.join(", ")}>{listener.pids.length > 1 ? `${listener.pids[0]} +${listener.pids.length - 1}` : listener.pid ?? "-"}</td><td>{listener.process ?? "未知程序"}</td><td>{listener.protocol.toUpperCase()}</td><td>{listener.addressFamily}</td><td>{interfaceText(listener.interfaceName)}</td><td>{listener.localAddress}</td><td>{listener.localPort}</td><td>{listener.ipCount}</td><td>{listener.connectionCount}</td><td>{rate(listener.sentBps)}</td><td>{rate(listener.receivedBps)}</td>
            </tr>
            ))}
            <VirtualTableSpacer height={virtualListeners.afterHeight} columns={11} />
          </tbody>
        </table>
        {!filtered.length && <div className="empty-state">当前没有匹配的监听端口</div>}
      </div>

      <section className="listener-connections">
        <header><strong>{selected ? endpoint(selected.localAddress, selected.localPort) : "连接明细"}</strong><span>{selected ? `${selected.process ?? "未知程序"} · ${selected.addressFamily} · ${interfaceText(selected.interfaceName)} · ${selected.connectionCount} 个连接${detailsLoadedKey === selected.key ? "" : " · 正在加载明细"}` : "选择上方监听程序查看连接"}</span></header>
        <div ref={virtualConnections.containerRef} className="listener-connections-table-wrap">
          <table className="data-table listener-connections-table virtualized-table">
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
            <tbody>
              <VirtualTableSpacer height={virtualConnections.beforeHeight} columns={10} />
              {virtualConnections.rows.map(({ item: socket, index }) => (
                <tr className={index % 2 ? "virtual-even" : ""} key={socket.key}><td>{socket.interfaceName ?? "-"}</td><td>{socket.localAddress}</td><td title={locationErrors[socket.remoteAddress]}>{locationText(locations[socket.remoteAddress], locationErrors[socket.remoteAddress])}</td><td>{socket.remoteAddress}</td><td>{socket.remotePort ?? "-"}</td><td>{socket.state}</td><td>{rate(socket.sentBps)}</td><td>{rate(socket.receivedBps)}</td><td>{socket.sentBytes == null ? "-" : formatBytes(socket.sentBytes)}</td><td>{socket.receivedBytes == null ? "-" : formatBytes(socket.receivedBytes)}</td></tr>
              ))}
              <VirtualTableSpacer height={virtualConnections.afterHeight} columns={10} />
            </tbody>
          </table>
          {selected && detailsLoadedKey !== selected.key && <div className="empty-state">正在加载连接明细...</div>}
          {selected && detailsLoadedKey === selected.key && !selected.connections.length && <div className="empty-state">该监听端口当前没有活动连接</div>}
          {!selected && <div className="empty-state">点击监听程序后在这里查看连接速率与 IP 信息</div>}
        </div>
      </section>
    </section>
  );
}
