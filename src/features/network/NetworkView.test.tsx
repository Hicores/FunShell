import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { mockConnections } from "../../lib/mock";
import { useAppStore } from "../../stores/appStore";
import type { GeoIpInfo, SocketInfo, WorkspaceTab } from "../../types";
import { lookupGeoIps, mergeBoundedRecord, NetworkView } from "./NetworkView";

describe("NetworkView", () => {
  it("does not poll while its workspace tab is hidden", () => {
    const listeners = vi.spyOn(api, "socketListeners");
    const connections = vi.spyOn(api, "socketConnections");
    const tab: WorkspaceTab = { id: "network-hidden", sessionId: "network-hidden", connectionId: mockConnections[0].id, title: "网络", kind: "network", state: "connected" };
    render(<NetworkView tab={tab} active={false} />);
    expect(listeners).not.toHaveBeenCalled();
    expect(connections).not.toHaveBeenCalled();
  });

  it("does not request connection details before a listener is selected", async () => {
    const listeners = vi.spyOn(api, "socketListeners");
    const connections = vi.spyOn(api, "socketConnections");
    const tab: WorkspaceTab = { id: "network-demand", sessionId: "network-demand", connectionId: mockConnections[0].id, title: "网络", kind: "network", state: "connected" };
    const { container } = render(<NetworkView tab={tab} />);
    const listenerTable = container.querySelector<HTMLTableElement>(".listener-table")!;

    await waitFor(() => expect(listeners).toHaveBeenCalledOnce());
    expect(connections).not.toHaveBeenCalled();
    const nginxRow = within(listenerTable).getAllByRole("row").find((row) => row.textContent?.includes("nginx"))!;
    const cells = within(nginxRow).getAllByRole("cell");
    expect(cells[7]).toHaveTextContent("2");
    expect(cells[8]).toHaveTextContent("2");
    expect(cells[9]).not.toHaveTextContent("-");
    expect(cells[10]).not.toHaveTextContent("-");
    fireEvent.click(nginxRow);
    await waitFor(() => expect(connections).toHaveBeenCalledWith("network-demand", "tcp", "IPv4", 80));
  });

  it("shows TCP listeners by default and filters UDP or all protocols", async () => {
    const tcp: SocketInfo = { protocol: "tcp", addressFamily: "IPv4", interfaceName: null, state: "LISTEN", localAddress: "0.0.0.0", localPort: 80, remoteAddress: "0.0.0.0", remotePort: null, pid: 10, process: "nginx", receivedBytes: null, sentBytes: null };
    const udp: SocketInfo = { protocol: "udp", addressFamily: "IPv4", interfaceName: null, state: "UNCONN", localAddress: "0.0.0.0", localPort: 53, remoteAddress: "0.0.0.0", remotePort: null, pid: 20, process: "dnsmasq", receivedBytes: null, sentBytes: null };
    vi.spyOn(api, "socketListeners").mockResolvedValue({ listeners: [tcp, udp], summaries: [] });
    const tab: WorkspaceTab = { id: "network-protocol", sessionId: "network-protocol", connectionId: mockConnections[0].id, title: "网络", kind: "network", state: "connected" };
    const { container } = render(<NetworkView tab={tab} />);
    const listenerTable = container.querySelector<HTMLTableElement>(".listener-table")!;
    const protocolFilter = within(container).getByRole("combobox", { name: "筛选协议" });

    await waitFor(() => expect(within(listenerTable).getByText("nginx")).toBeInTheDocument());
    expect(protocolFilter).toHaveValue("tcp");
    expect(within(listenerTable).queryByText("dnsmasq")).not.toBeInTheDocument();
    fireEvent.change(protocolFilter, { target: { value: "udp" } });
    expect(within(listenerTable).getByText("dnsmasq")).toBeInTheDocument();
    expect(within(listenerTable).queryByText("nginx")).not.toBeInTheDocument();
    fireEvent.change(protocolFilter, { target: { value: "all" } });
    expect(within(listenerTable).getByText("dnsmasq")).toBeInTheDocument();
    expect(within(listenerTable).getByText("nginx")).toBeInTheDocument();
  });

  it("shows matching IPv4 and IPv6 listeners as one row and loads both families", async () => {
    const connections = vi.spyOn(api, "socketConnections");
    const tab: WorkspaceTab = { id: "network-dual", sessionId: "network-dual", connectionId: mockConnections[0].id, title: "网络", kind: "network", state: "connected" };
    const { container } = render(<NetworkView tab={tab} />);
    const listenerTable = container.querySelector<HTMLTableElement>(".listener-table")!;

    await waitFor(() => expect(within(listenerTable).getAllByRole("row").length).toBeGreaterThan(2));
    const sshdRows = within(listenerTable).getAllByRole("row").filter((row) => row.textContent?.includes("sshd"));
    expect(sshdRows).toHaveLength(1);
    expect(sshdRows[0]).toHaveTextContent("IPv4/IPv6");
    expect(sshdRows[0]).toHaveTextContent("全部地址");
    fireEvent.click(sshdRows[0]);

    await waitFor(() => {
      expect(connections).toHaveBeenCalledWith("network-dual", "tcp", "IPv4", 22);
      expect(connections).toHaveBeenCalledWith("network-dual", "tcp", "IPv6", 22);
    });
  });

  it("evicts the oldest IP metadata when the frontend cache reaches its limit", () => {
    expect(mergeBoundedRecord({ first: 1, second: 2 }, [["third", 3]], 2)).toEqual({ second: 2, third: 3 });
  });

  it("publishes each IP result without waiting for the whole lookup batch", async () => {
    let releaseSlowLookup: (value: GeoIpInfo) => void = () => undefined;
    const slowLookup = new Promise<GeoIpInfo>((resolve) => { releaseSlowLookup = resolve; });
    const result = (ip: string): GeoIpInfo => ({ ip, private: false, country: "中国", region: "四川省", city: null, isp: null, latitude: null, longitude: null, cachedAt: "2026-07-19T00:00:00Z" });
    const received = vi.fn();
    const lookup = vi.fn((ip: string) => ip === "slow" ? slowLookup : Promise.resolve(result(ip)));

    const complete = lookupGeoIps(["slow", "220.167.110.40"], received, lookup);
    await waitFor(() => expect(received).toHaveBeenCalledWith(expect.objectContaining({ ip: "220.167.110.40", info: expect.objectContaining({ country: "中国" }) })));
    expect(received).not.toHaveBeenCalledWith(expect.objectContaining({ ip: "slow" }));
    releaseSlowLookup(result("slow"));
    await complete;
  });

  it("sorts listener names and connection traffic from their headers", async () => {
    const tab: WorkspaceTab = { id: "network-sort", sessionId: "network-sort", connectionId: mockConnections[0].id, title: "网络", kind: "network", state: "connected" };
    useAppStore.setState({ toast: null });
    const { container } = render(<NetworkView tab={tab} />);
    const listenerTable = container.querySelector<HTMLTableElement>(".listener-table")!;

    await waitFor(() => expect(within(listenerTable).getAllByRole("row").length).toBeGreaterThan(2));
    const nameHeader = within(listenerTable).getByRole("columnheader", { name: "名称" });
    fireEvent.click(within(nameHeader).getByRole("button"));
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    expect(within(listenerTable).getAllByRole("row")[1]).toHaveTextContent("java");

    const nginxRow = within(listenerTable).getAllByRole("row").find((row) => row.textContent?.includes("nginx"))!;
    fireEvent.click(nginxRow);
    const connectionTable = container.querySelector<HTMLTableElement>(".listener-connections-table")!;
    await waitFor(() => expect(within(connectionTable).getAllByRole("row")).toHaveLength(3));
    const trafficHeader = within(connectionTable).getByRole("columnheader", { name: "累计上传" });
    fireEvent.click(within(trafficHeader).getByRole("button"));
    expect(trafficHeader).toHaveAttribute("aria-sort", "descending");
    expect(within(connectionTable).getAllByRole("row")[1]).toHaveTextContent("42.48.120.32");
  });
});
