import { describe, expect, it } from "vitest";
import type { SocketInfo, SocketListenerSummary } from "../../types";
import { buildListeners, rateSocketSamples, socketKey } from "./networkModel";

const listener: SocketInfo = { protocol: "tcp", addressFamily: "IPv4", interfaceName: null, state: "LISTEN", localAddress: "0.0.0.0", localPort: 80, remoteAddress: "0.0.0.0", remotePort: null, pid: 10, process: "nginx", receivedBytes: null, sentBytes: null };
const connection: SocketInfo = { protocol: "tcp", addressFamily: "IPv4", interfaceName: "eth0", state: "ESTAB", localAddress: "10.0.0.2", localPort: 80, remoteAddress: "8.8.8.8", remotePort: 45120, pid: 11, process: "nginx", receivedBytes: 5_000, sentBytes: 9_000 };
const summary: SocketListenerSummary = { protocol: "tcp", addressFamily: "IPv4", localAddress: "10.0.0.2", localPort: 80, connectionCount: 4_200, ipCount: 3_180, receivedBps: 2_000, sentBps: 4_000 };

describe("network listener model", () => {
  it("calculates per-second rates from cumulative TCP counters", () => {
    const previous = new Map([[socketKey(connection), { ...connection, receivedBytes: 3_000, sentBytes: 5_000 }]]);
    const rated = rateSocketSamples([listener, connection], previous, 2_000);
    expect(rated[1].sentBps).toBe(2_000);
    expect(rated[1].receivedBps).toBe(1_000);
  });

  it("groups accepted connections under wildcard listeners", () => {
    const rated = rateSocketSamples([listener, connection], new Map(), 2_000);
    const rows = buildListeners(rated);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ process: "nginx", localPort: 80, ipCount: 1, connectionCount: 1 });
    expect(rows[0].connections[0].remoteAddress).toBe("8.8.8.8");
  });

  it("uses listener rates calculated by the compact remote summary", () => {
    const rows = buildListeners(rateSocketSamples([listener], new Map(), 2_000), [summary]);
    expect(rows[0]).toMatchObject({ connectionCount: 4_200, ipCount: 3_180, sentBps: 4_000, receivedBps: 2_000 });
  });

  it("merges matching IPv4 and IPv6 listeners into one row", () => {
    const ipv6Listener = { ...listener, addressFamily: "IPv6", localAddress: "::", remoteAddress: "::" };
    const ipv6Connection = { ...connection, addressFamily: "IPv6", interfaceName: "eth1", localAddress: "2001:db8::10", remoteAddress: "2001:db8::20" };
    const rated = rateSocketSamples([listener, ipv6Listener, connection, ipv6Connection], new Map(), 2_000);
    const rows = buildListeners(rated);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ addressFamily: "IPv4/IPv6", addressFamilies: ["IPv4", "IPv6"], localAddress: "全部地址" });
    expect(rows[0].connections).toHaveLength(2);
    expect(rows[0].connections[1].interfaceName).toBe("eth1");
  });

  it("merges different PIDs from the same program and wildcard endpoint", () => {
    const ipv6Listener = { ...listener, pid: 20, addressFamily: "IPv6", localAddress: "::", remoteAddress: "::" };
    const rows = buildListeners(rateSocketSamples([listener, ipv6Listener], new Map(), 2_000));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pids: [10, 20], process: "nginx", addressFamily: "IPv4/IPv6" });
  });

  it("recognizes an IPv6 wildcard listener with mapped IPv4 traffic as dual stack", () => {
    const ipv6Listener = { ...listener, addressFamily: "IPv6", localAddress: "::", remoteAddress: "::" };
    const mappedSummary = { ...summary, addressFamily: "IPv6", localAddress: "10.0.0.2" };
    const rows = buildListeners(rateSocketSamples([ipv6Listener], new Map(), 2_000), [mappedSummary]);
    expect(rows[0]).toMatchObject({ addressFamily: "IPv4/IPv6", addressFamilies: ["IPv6"], dualStack: true, localAddress: "全部地址" });
  });
});
