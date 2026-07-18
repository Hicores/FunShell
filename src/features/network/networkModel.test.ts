import { describe, expect, it } from "vitest";
import type { SocketInfo } from "../../types";
import { buildListeners, rateSocketSamples, socketKey } from "./networkModel";

const listener: SocketInfo = { protocol: "tcp", state: "LISTEN", localAddress: "0.0.0.0", localPort: 80, remoteAddress: "0.0.0.0", remotePort: null, pid: 10, process: "nginx", receivedBytes: null, sentBytes: null };
const connection: SocketInfo = { protocol: "tcp", state: "ESTAB", localAddress: "10.0.0.2", localPort: 80, remoteAddress: "8.8.8.8", remotePort: 45120, pid: 11, process: "nginx", receivedBytes: 5_000, sentBytes: 9_000 };

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
});
