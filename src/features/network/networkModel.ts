import type { SocketInfo, SocketListenerSummary } from "../../types";

export interface RatedSocket extends SocketInfo {
  key: string;
  sentBps: number | null;
  receivedBps: number | null;
}

export interface ListenerInfo {
  key: string;
  pid: number | null;
  process: string | null;
  protocol: string;
  addressFamily: string;
  interfaceName: string | null;
  localAddress: string;
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

export function buildListeners(sockets: RatedSocket[], summaries?: SocketListenerSummary[]): ListenerInfo[] {
  return sockets
    .filter(isListener)
    .map((listener) => {
      const connections = sockets.filter((socket) => accepts(listener, socket));
      const matchingSummaries = summaries?.filter((summary) => acceptsSummary(listener, summary));
      return {
        key: listener.key,
        pid: listener.pid,
        process: listener.process,
        protocol: listener.protocol,
        addressFamily: listener.addressFamily,
        interfaceName: listener.interfaceName,
        localAddress: listener.localAddress,
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
    })
    .sort((left, right) => right.connectionCount - left.connectionCount || left.localPort - right.localPort);
}
