import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { WorkspaceTab } from "../../types";
import { FileManager } from "./FileManager";

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

  it("opens a remote file in the text editor on double click", async () => {
    const readText = vi.spyOn(api, "readRemoteText").mockResolvedValue({
      path: "/root/deploy.sh",
      content: "#!/bin/sh\necho deploy\n",
      size: 23,
    });
    const openRemote = vi.spyOn(api, "openRemoteFile");
    render(<FileManager tab={tab} />);

    fireEvent.doubleClick(await screen.findByText("deploy.sh"));

    await waitFor(() => expect(readText).toHaveBeenCalledWith("session-1", "/root/deploy.sh"));
    expect(openRemote).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "远程编辑 - /root/deploy.sh" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("#!/bin/sh\necho deploy\n");
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

  it("uploads dropped local paths from the file list", async () => {
    const upload = vi.spyOn(api, "uploadRemoteFile").mockResolvedValue("transfer-1");
    const { container } = render(<FileManager tab={tab} />);
    await screen.findByText("deploy.sh");
    const list = container.querySelector<HTMLElement>(".file-table-wrap")!;

    fireEvent.dragOver(list, { dataTransfer: { types: ["Files"], dropEffect: "none" } });
    expect(list).toHaveClass("drop-active");
    fireEvent.drop(list, { dataTransfer: { files: [{ name: "release.zip", path: "C:\\builds\\release.zip" }] } });

    await waitFor(() => expect(upload).toHaveBeenCalledWith(tab.sessionId, "C:\\builds\\release.zip", "/root/release.zip"));
  });
});
