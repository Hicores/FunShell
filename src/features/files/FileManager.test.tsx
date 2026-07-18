import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { WorkspaceTab } from "../../types";
import { FileManager } from "./FileManager";
import { useTransferStore } from "./transferStore";

const tab: WorkspaceTab = {
  id: "session-1",
  sessionId: "session-1",
  connectionId: "gateway-edge",
  title: "边缘网关",
  kind: "terminal",
  state: "connected",
};

describe("FileManager", () => {
  beforeEach(() => {
    useAppStore.setState({ activeTabId: tab.id, toast: null });
    useTransferStore.setState({ bySession: {} });
  });

  it("selects a file and confirms remote deletion", async () => {
    const remove = vi.spyOn(api, "deleteRemotePath");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FileManager tab={tab} />);

    const fileName = await screen.findByText("deploy.sh");
    fireEvent.click(fileName);
    expect(screen.getByRole("button", { name: "下载" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("session-1", "/root/deploy.sh", false, false));
  });

  it("renders a text-only context menu", async () => {
    render(<FileManager tab={tab} />);
    const fileName = await screen.findByText("deploy.sh");
    fireEvent.contextMenu(fileName);
    const menu = screen.getByRole("menu");
    expect(menu.querySelectorAll("svg")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "文本编辑" })).toBeInTheDocument();
  });

  it("shows directory commands on empty space and creates an empty remote file", async () => {
    const createFile = vi.spyOn(api, "createRemoteFile").mockResolvedValue(undefined);
    const { container } = render(<FileManager tab={tab} />);
    await screen.findByText("deploy.sh");

    const list = container.querySelector<HTMLElement>(".file-table-wrap")!;
    fireEvent.contextMenu(list, { clientX: 180, clientY: 220 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("button").map((button) => button.textContent)).toEqual(["刷新", "新建文件", "新建文件夹", "上传文件"]);

    fireEvent.click(within(menu).getByRole("button", { name: "新建文件" }));
    expect(screen.getByRole("dialog", { name: "新建文件" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("文件名称"), { target: { value: "healthcheck.txt" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(createFile).toHaveBeenCalledWith(tab.sessionId, "/root/healthcheck.txt"));
  });

  it("uploads dropped local paths and opens transfer history from the top-right button", async () => {
    const upload = vi.spyOn(api, "uploadRemoteFile").mockResolvedValue("transfer-1");
    const { container } = render(<FileManager tab={tab} />);
    await screen.findByText("deploy.sh");
    const list = container.querySelector<HTMLElement>(".file-table-wrap")!;

    fireEvent.dragOver(list, { dataTransfer: { types: ["Files"], dropEffect: "none" } });
    expect(list).toHaveClass("drop-active");
    fireEvent.drop(list, { dataTransfer: { files: [{ name: "release.zip", path: "C:\\builds\\release.zip" }] } });

    await waitFor(() => expect(upload).toHaveBeenCalledWith(tab.sessionId, "C:\\builds\\release.zip", "/root/release.zip"));
    expect(screen.getByRole("region", { name: "传输进度与历史" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭传输记录" }));
    expect(screen.queryByRole("region", { name: "传输进度与历史" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "传输记录" }));
    expect(screen.getByRole("region", { name: "传输进度与历史" })).toBeInTheDocument();
  });
});
