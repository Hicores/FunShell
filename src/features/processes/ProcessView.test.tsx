import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import type { WorkspaceTab } from "../../types";
import { ProcessView } from "./ProcessView";

const tab: WorkspaceTab = {
  id: "session-1:processes",
  sessionId: "session-1",
  connectionId: "gateway-edge",
  title: "进程-边缘网关",
  kind: "processes",
  state: "connected",
};

describe("ProcessView", () => {
  it("filters the process table by command metadata", async () => {
    render(<ProcessView tab={tab} />);
    await waitFor(() => expect(screen.getByText("java")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("搜索 PID、用户、名称或命令"), {
      target: { value: "nginx" },
    });

    expect(screen.getByText("nginx")).toBeInTheDocument();
    expect(screen.queryByText("java")).not.toBeInTheDocument();
  });

  it("sorts process columns and exposes force stop from the row context menu", async () => {
    const terminate = vi.spyOn(api, "terminateProcess").mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<ProcessView tab={tab} />);
    const table = container.querySelector<HTMLTableElement>(".process-table")!;
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(5));

    const memoryHeader = within(table).getByRole("columnheader", { name: "内存" });
    fireEvent.click(within(memoryHeader).getByRole("button"));
    expect(memoryHeader).toHaveAttribute("aria-sort", "descending");
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("java");

    expect(screen.queryByRole("button", { name: "强制停止" })).not.toBeInTheDocument();
    const nginxRow = within(table).getAllByRole("row").find((row) => row.textContent?.includes("nginx"))!;
    fireEvent.contextMenu(nginxRow, { clientX: 80, clientY: 90 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "强制停止" }));

    await waitFor(() => expect(terminate).toHaveBeenCalledWith(tab.sessionId, 488485, true));
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
