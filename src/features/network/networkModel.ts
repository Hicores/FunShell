import type { SocketInfo, SocketListenerSummary } from "../../types";

export interface RatedSocket extends SocketInfo {
  key: string;
  sentBps: number | null;
  receivedBps: number | null;
}

export interface ListenerInfo {
  key: string;
  pid: number | null;
  pids: number[];
  process: string | null;
  protocol: string;
  addressFamily: string;
  addressFamilies: string[];
  dualStack: boolean;
  interfaceName: string | null;
  localAddress: string;
  localAddresses: string[];
  localPort: number;
  ipCount: number;
  connectionCount: number;
  sentBps: number | null;
  receivedBps: number | null;
  connections: RatedSocket[];
}

export function socketKey(socket: SocketInfo) {
  return [socket.protocol, socket.addressFamily, socket.interfaceName ?? "", socket.localAddress, socket.localPort ?? "", socket.remoteAddress, socket.remotePort ?? "", socket.pid ?? ""].join("|");
}

export function rateSocketSamples(
  sockets: SocketInfo[],
  previous: ReadonlyMap<string, SocketInfo>,
  elapsedMilliseconds: number,
): RatedSocket[] {
  const elapsedSeconds = Math.max(elapsedMilliseconds / 1000, 0.001);
  return sockets.map((socket) => {
    const key = socketKey(socket);
    const old = previous.get(key);
    const rate = (current: number | null, before: number | null | undefined) => {
      if (current == null) return null;
      if (before == null) return 0;
      return Math.round(Math.max(0, current - before) / elapsedSeconds);
    };
    return {
      ...socket,
      key,
      sentBps: rate(socket.sentBytes, old?.sentBytes),
      receivedBps: rate(socket.receivedBytes, old?.receivedBytes),
    };
  });
}

function isListener(socket: SocketInfo) {
  const state = socket.state.toUpperCase();
  return socket.localPort != null
    && (state === "LISTEN" || (socket.protocol.toLowerCase().startsWith("udp") && state === "UNCONN"));
}

function accepts(listener: RatedSocket, connection: RatedSocket) {
  if (isListener(connection) || connection.remotePort == null) return false;
  if (listener.protocol.toLowerCase() !== connection.protocol.toLowerCase()) return false;
  if (listener.addressFamily !== connection.addressFamily) return false;
  if (listener.localPort !== connection.localPort) return false;
  const wildcard = ["0.0.0.0", "::", "*"].includes(listener.localAddress);
  return wildcard || listener.localAddress === connection.localAddress;
}

function acceptsSummary(listener: RatedSocket, summary: SocketListenerSummary) {
  if (listener.protocol.toLowerCase() !== summary.protocol.toLowerCase()) return false;
  if (listener.addressFamily !== summary.addressFamily) return false;
  if (listener.localPort !== summary.localPort) return false;
  const wildcard = ["0.0.0.0", "::", "*"].includes(listener.localAddress);
  return wildcard || listener.localAddress === summary.localAddress;
}

function sumKnown(values: Array<number | null>) {
  const known = values.filter((value): value is number => value != null);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
}

function isIpv4Address(address: string) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(address);
}

function listenerAddressScope(address: string) {
  if (["0.0.0.0", "::", "*"].includes(address)) return "all";
  if (["127.0.0.1", "::1"].includes(address)) return "loopback";
  return `address:${address}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function connectionMergeKey(socket: RatedSocket) {
  return [socket.protocol.toLowerCase(), socket.interfaceName ?? "", socket.localAddress, socket.localPort ?? "", socket.remoteAddress, socket.remotePort ?? "", socket.pid ?? "", socket.state].join("|");
}

function mergeConnections(connections: RatedSocket[]) {
  const merged = new Map<string, RatedSocket>();
  connections.forEach((connection) => {
    const key = connectionMergeKey(connection);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, connection);
      return;
    }
    merged.set(key, {
      ...current,
      sentBytes: current.sentBytes ?? connection.sentBytes,
      receivedBytes: current.receivedBytes ?? connection.receivedBytes,
      sentBps: current.sentBps ?? connection.sentBps,
      receivedBps: current.receivedBps ?? connection.receivedBps,
    });
  });
  return [...merged.values()];
}

export function buildListeners(sockets: RatedSocket[], summaries?: SocketListenerSummary[]): ListenerInfo[] {
  const listeners = sockets
    .filter(isListener)
    .map((listener) => {
      const connections = sockets.filter((socket) => accepts(listener, socket));
      const matchingSummaries = summaries?.filter((summary) => acceptsSummary(listener, summary));
      const dualStack = listener.addressFamily === "IPv6" && (
        matchingSummaries?.some((summary) => isIpv4Address(summary.localAddress))
        || connections.some((connection) => isIpv4Address(connection.localAddress))
        || false
      );
      return {
        key: listener.key,
        pid: listener.pid,
        pids: listener.pid == null ? [] : [listener.pid],
        process: listener.process,
        protocol: listener.protocol,
        addressFamily: listener.addressFamily,
        addressFamilies: [listener.addressFamily],
        dualStack,
        interfaceName: listener.interfaceName,
        localAddress: listener.localAddress,
        localAddresses: [listener.localAddress],
        localPort: listener.localPort!,
        ipCount: matchingSummaries
          ? matchingSummaries.reduce((total, summary) => total + summary.ipCount, 0)
          : new Set(connections.map((socket) => socket.remoteAddress).filter((ip) => ip && !["0.0.0.0", "::", "*"].includes(ip))).size,
        connectionCount: matchingSummaries
          ? matchingSummaries.reduce((total, summary) => total + summary.connectionCount, 0)
          : connections.length,
        sentBps: sumKnown(matchingSummaries ? matchingSummaries.map((summary) => summary.sentBps) : connections.map((socket) => socket.sentBps)),
        receivedBps: sumKnown(matchingSummaries ? matchingSummaries.map((summary) => summary.receivedBps) : connections.map((socket) => socket.receivedBps)),
        connections,
      };
    });

  const groups = new Map<string, ListenerInfo[]>();
  listeners.forEach((listener) => {
    const program = listener.process?.toLowerCase() ?? `pid:${listener.pid ?? listener.key}`;
    const scope = listenerAddressScope(listener.localAddress);
    const key = [listener.protocol.toLowerCase(), program, listener.localPort, listener.interfaceName ?? "", scope].join("|");
    groups.set(key, [...(groups.get(key) ?? []), listener]);
  });

  return [...groups.entries()]
    .map(([key, members]) => {
      const first = members[0];
      const addressFamilies = unique(members.flatMap((listener) => listener.addressFamilies)).sort();
      const localAddresses = unique(members.flatMap((listener) => listener.localAddresses));
      const pids = unique(members.flatMap((listener) => listener.pids)).sort((left, right) => left - right);
      const connections = mergeConnections(members.flatMap((listener) => listener.connections));
      const dualStack = addressFamilies.length > 1 || members.some((listener) => listener.dualStack);
      const scope = listenerAddressScope(first.localAddress);
      return {
        ...first,
        key: `listener|${key}`,
        pid: pids[0] ?? null,
        pids,
        addressFamily: dualStack ? "IPv4/IPv6" : addressFamilies[0],
        addressFamilies,
        dualStack,
        localAddress: scope === "all" && dualStack ? "全部地址" : localAddresses.join(" / "),
        localAddresses,
        ipCount: members.reduce((total, listener) => total + listener.ipCount, 0),
        connectionCount: members.reduce((total, listener) => total + listener.connectionCount, 0),
        sentBps: sumKnown(members.map((listener) => listener.sentBps)),
        receivedBps: sumKnown(members.map((listener) => listener.receivedBps)),
        connections,
      };
    })
    .sort((left, right) => right.connectionCount - left.connectionCount || left.localPort - right.localPort);
}
