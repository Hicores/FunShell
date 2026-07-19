import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { mockConnections } from "../../lib/mock";
import { useAppStore } from "../../stores/appStore";
import type { WorkspaceTab } from "../../types";
import { mergeBoundedRecord, NetworkView } from "./NetworkView";

describe("NetworkView", () => {
  it("does not poll while its workspace tab is hidden", () => {
    const sockets = vi.spyOn(api, "sockets");
    const tab: WorkspaceTab = { id: "network-hidden", sessionId: "network-hidden", connectionId: mockConnections[0].id, title: "网络", kind: "network", state: "connected" };
    render(<NetworkView tab={tab} active={false} />);
    expect(sockets).not.toHaveBeenCalled();
  });

  it("evicts the oldest IP metadata when the frontend cache reaches its limit", () => {
    expect(mergeBoundedRecord({ first: 1, second: 2 }, [["third", 3]], 2)).toEqual({ second: 2, third: 3 });
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
