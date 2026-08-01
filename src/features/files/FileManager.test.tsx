import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { mockRemoteFiles } from "../../lib/mock";
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
    expect(screen.getAllByText("root/root").length).toBeGreaterThan(0);
    expect(screen.queryByText("root (0)/root (0)")).not.toBeInTheDocument();

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

  it("shows the source path for symbolic links", async () => {
    render(<FileManager tab={tab} />);

    const linkName = await screen.findByText("gateway-current");
    const row = linkName.closest("tr")!;
    expect(within(row).getByText("链接来源：/opt/gateway/releases/2026-07-18")).toHaveAttribute(
      "title",
      "链接来源：/opt/gateway/releases/2026-07-18",
    );
    expect(within(row).getByText("链接")).toBeInTheDocument();
  });

  it("edits basic and extended file permission bits visually", async () => {
    const listIdentities = vi.spyOn(api, "remoteIdentities").mockResolvedValue({
      users: [{ name: "root", id: 0 }, { name: "deploy", id: 1000 }],
      groups: [{ name: "root", id: 0 }, { name: "release", id: 1000 }],
    });
    const chown = vi.spyOn(api, "chownRemotePath").mockResolvedValue(undefined);
    const chmod = vi.spyOn(api, "chmodRemotePath").mockResolvedValue(undefined);
    render(<FileManager tab={tab} />);
    const fileName = await screen.findByText("deploy.sh");
    fireEvent.contextMenu(fileName);
    fireEvent.click(screen.getByRole("button", { name: "文件权限..." }));

    const dialog = screen.getByRole("dialog", { name: "修改文件权限" });
    expect(within(dialog).getByText("0755")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "所有者" })).toHaveValue("root");
    expect(within(dialog).getByRole("textbox", { name: "用户组" })).toHaveValue("root");
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "服务器用户" })).toBeEnabled());
    expect(listIdentities).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole("option", { name: "deploy (1000)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "release (1000)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "所有者 读取" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "组 写入" })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "设置用户 ID (setuid)" })).not.toBeChecked();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "组 写入" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "粘滞位 (sticky)" }));
    fireEvent.change(within(dialog).getByRole("combobox", { name: "服务器用户" }), { target: { value: "deploy" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "服务器用户组" }), { target: { value: "release" } });
    expect(within(dialog).getByRole("textbox", { name: "所有者" })).toHaveValue("deploy");
    expect(within(dialog).getByRole("textbox", { name: "用户组" })).toHaveValue("release");
    expect(within(dialog).getByText("1775")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "确定" }));

    await waitFor(() => expect(chown).toHaveBeenCalledWith(tab.sessionId, "/root/deploy.sh", "deploy", "release"));
    expect(chmod).toHaveBeenCalledWith(tab.sessionId, "/root/deploy.sh", 0o1775);
  });

  it("does not change ownership when only permission bits were edited", async () => {
    vi.spyOn(api, "remoteIdentities").mockResolvedValue({
      users: [{ name: "root", id: 0 }],
      groups: [{ name: "root", id: 0 }],
    });
    const chown = vi.spyOn(api, "chownRemotePath").mockResolvedValue(undefined);
    const chmod = vi.spyOn(api, "chmodRemotePath").mockResolvedValue(undefined);
    render(<FileManager tab={tab} />);
    const fileName = await screen.findByText("deploy.sh");
    fireEvent.contextMenu(fileName);
    fireEvent.click(screen.getByRole("button", { name: "文件权限..." }));

    const dialog = screen.getByRole("dialog", { name: "修改文件权限" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "组 写入" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "确定" }));

    await waitFor(() => expect(chmod).toHaveBeenCalledWith(tab.sessionId, "/root/deploy.sh", 0o775));
    expect(chown).not.toHaveBeenCalled();
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
    const editor = screen.getByRole("dialog", { name: "远程编辑 - /root/deploy.sh" });
    expect(editor).toBeInTheDocument();
    expect(within(editor).getByRole("textbox")).toHaveValue("#!/bin/sh\necho deploy\n");
  });

  it("shows a loading state while reading a remote text file", async () => {
    let resolveRead: ((value: { path: string; content: string; size: number }) => void) | undefined;
    vi.spyOn(api, "readRemoteText").mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    render(<FileManager tab={tab} />);

    fireEvent.doubleClick(await screen.findByText("deploy.sh"));
    const loadingDialog = await screen.findByRole("dialog", { name: "正在打开 - /root/deploy.sh" });
    expect(loadingDialog).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在读取 deploy.sh...");
    expect(within(loadingDialog).queryByRole("textbox")).not.toBeInTheDocument();

    resolveRead?.({ path: "/root/deploy.sh", content: "echo deploy\n", size: 12 });
    expect(await screen.findByRole("dialog", { name: "远程编辑 - /root/deploy.sh" })).toBeInTheDocument();
  });

  it("keeps multiple remote files open in independent editor panes", async () => {
    const readText = vi.spyOn(api, "readRemoteText").mockImplementation(async (_sessionId, path) => ({ path, content: path, size: path.length }));
    render(<FileManager tab={tab} />);

    fireEvent.doubleClick(await screen.findByText("deploy.sh"));
    const firstEditor = await screen.findByRole("dialog", { name: "远程编辑 - /root/deploy.sh" });
    fireEvent.click(within(firstEditor).getByRole("button", { name: "打开文件" }));
    const picker = await screen.findByRole("dialog", { name: "打开远程文件" });
    fireEvent.click(within(picker).getByRole("button", { name: /^\.bash_history/ }));

    const workspace = await screen.findByRole("dialog", { name: "远程编辑 (2 个文件)" });
    await waitFor(() => expect(readText).toHaveBeenCalledWith(tab.sessionId, "/root/.bash_history"));
    const editors = within(workspace).getAllByRole("textbox");
    expect(editors).toHaveLength(2);
    fireEvent.change(editors[0], { target: { value: "changed" } });
    expect(editors[1]).toHaveValue("/root/.bash_history");
  });

  it("packs a file or directory into the current directory with a customizable tar.gz name", async () => {
    const createArchive = vi.spyOn(api, "createRemoteArchive").mockResolvedValue("/root/gateway-backup.tar.gz");
    render(<FileManager tab={tab} />);

    fireEvent.contextMenu(await screen.findByText("gateway"));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("button", { name: "打包" }));

    const dialog = screen.getByRole("dialog", { name: "打包为 tar.gz" });
    expect(within(dialog).getByRole("textbox", { name: "打包对象" })).toHaveValue("/root/gateway");
    expect(within(dialog).getByRole("textbox", { name: "压缩包保存目录" })).toHaveValue("/root");
    expect((within(dialog).getByRole("textbox", { name: "压缩包名称" }) as HTMLInputElement).value).toMatch(/^gateway\.\d{8}-\d{6}\.tar\.gz$/);

    fireEvent.change(within(dialog).getByRole("textbox", { name: "压缩包名称" }), { target: { value: "gateway-backup" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "开始打包" }));
    await waitFor(() => expect(createArchive).toHaveBeenCalledWith(tab.sessionId, "/root/gateway", "/root/gateway-backup.tar.gz"));
  });

  it("extracts tar.gz archives to the containing directory by default or a custom path", async () => {
    const extractArchive = vi.spyOn(api, "extractRemoteArchive").mockResolvedValue("/srv/restored");
    render(<FileManager tab={tab} />);

    fireEvent.contextMenu(await screen.findByText("gateway-release.tar.gz"));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("button", { name: "解包" }));

    const dialog = screen.getByRole("dialog", { name: "解包 tar.gz" });
    expect(within(dialog).getByRole("textbox", { name: "待解包文件" })).toHaveValue("/root/gateway-release.tar.gz");
    expect(within(dialog).getByRole("textbox", { name: "解包路径" })).toHaveValue("/root");

    fireEvent.change(within(dialog).getByRole("textbox", { name: "解包路径" }), { target: { value: "/srv/restored" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "开始解包" }));
    await waitFor(() => expect(extractArchive).toHaveBeenCalledWith(tab.sessionId, "/root/gateway-release.tar.gz", "/srv/restored"));
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

  it("creates entries in the directory selected from the tree context menu", async () => {
    const createDirectory = vi.spyOn(api, "createRemoteDirectory").mockResolvedValue(undefined);
    render(<FileManager tab={tab} />);
    await screen.findByText("deploy.sh");

    fireEvent.contextMenu(screen.getByRole("button", { name: "etc" }), { clientX: 120, clientY: 180 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("button", { name: "新建文件" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("button", { name: "新建文件夹" }));

    expect(screen.getByLabelText("目标目录")).toHaveValue("/etc");
    fireEvent.change(screen.getByLabelText("文件夹名称"), { target: { value: "funshell.d" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(createDirectory).toHaveBeenCalledWith(tab.sessionId, "/etc/funshell.d"));
  });

  it("opens an absolute remote path entered in the address field", async () => {
    const listFiles = vi.spyOn(api, "remoteFiles").mockImplementation(async (_sessionId, remotePath) => {
      if (remotePath === "/") return [{ ...mockRemoteFiles[0], name: "srv", path: "/srv" }];
      if (remotePath === "/srv") return [{ ...mockRemoteFiles[0], name: "apps", path: "/srv/apps" }];
      if (remotePath === "/srv/apps") return [];
      return mockRemoteFiles;
    });
    render(<FileManager tab={tab} />);
    await screen.findByText("deploy.sh");

    const address = screen.getByRole("textbox", { name: "当前目录" });
    fireEvent.change(address, { target: { value: "/srv/apps" } });
    fireEvent.keyDown(address, { key: "Enter" });

    await waitFor(() => expect(listFiles).toHaveBeenCalledWith(tab.sessionId, "/srv/apps"));
    expect(address).toHaveValue("/srv/apps");
    await waitFor(() => expect(screen.getByTitle("/srv/apps").closest(".remote-tree-row")).toHaveClass("active"));
    expect(screen.getByTitle("/srv")).toBeInTheDocument();
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
