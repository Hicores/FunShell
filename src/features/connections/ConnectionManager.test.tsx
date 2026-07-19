import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { mockConnections, mockFolders } from "../../lib/mock";
import { useAppStore } from "../../stores/appStore";
import { ConnectionEditor } from "./ConnectionEditor";
import { ConnectionManager } from "./ConnectionManager";

describe("ConnectionManager", () => {
  it("creates folders from a styled modal instead of a browser prompt", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const saveFolder = vi.spyOn(api, "saveFolder").mockResolvedValue({ id: "folder-new", parentId: null, name: "数据库服务器", sortOrder: 2, deleted: false });
    useAppStore.setState({
      connectionManagerOpen: true,
      connections: mockConnections,
      folders: mockFolders,
      refreshConnections: refresh,
    });
    render(<ConnectionManager />);

    fireEvent.click(screen.getByRole("button", { name: "新建目录" }));
    const dialog = screen.getByRole("dialog", { name: "新建目录" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(dialog).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("目录名称"), { target: { value: "  数据库服务器  " } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(saveFolder).toHaveBeenCalledWith({ id: "", parentId: null, name: "数据库服务器", sortOrder: mockFolders.length, deleted: false }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "新建目录" })).not.toBeInTheDocument();
  });

  it("uses the selected folder for a newly created connection", () => {
    useAppStore.setState({
      connectionManagerOpen: true,
      connectionEditorOpen: false,
      editingConnection: null,
      newConnectionFolderId: null,
      connections: mockConnections,
      folders: mockFolders,
      keys: [],
      routes: [],
    });
    render(<><ConnectionManager /><ConnectionEditor /></>);

    fireEvent.click(screen.getByRole("button", { name: /生产环境\s*2/ }));
    fireEvent.click(screen.getByRole("button", { name: "新建连接" }));

    expect(screen.getByRole("dialog", { name: "新建连接" })).toBeInTheDocument();
    expect(screen.getByLabelText("目录")).toHaveValue(mockFolders[0].id);
  });

  it("opens a text-only server context menu instead of editing immediately", () => {
    const editConnection = vi.fn();
    useAppStore.setState({
      connectionManagerOpen: true,
      connections: mockConnections,
      folders: mockFolders,
      editConnection,
    });
    render(<ConnectionManager />);

    const row = screen.getByText(mockConnections[0].name).closest("tr")!;
    fireEvent.contextMenu(row, { clientX: 120, clientY: 160 });

    const menu = screen.getByRole("menu");
    expect(editConnection).not.toHaveBeenCalled();
    expect(within(menu).getByRole("button", { name: "连接" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "移动到..." })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(menu.querySelector("svg")).toBeNull();

    fireEvent.click(within(menu).getByRole("button", { name: "编辑" }));
    expect(editConnection).toHaveBeenCalledWith(mockConnections[0]);
  });

  it("moves a server to the folder selected from the context action", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const moveConnection = vi.spyOn(api, "moveConnection").mockResolvedValue(undefined);
    useAppStore.setState({
      connectionManagerOpen: true,
      connections: mockConnections,
      folders: mockFolders,
      refreshConnections: refresh,
    });
    render(<ConnectionManager />);

    fireEvent.contextMenu(screen.getByText(mockConnections[0].name).closest("tr")!, { clientX: 120, clientY: 160 });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("button", { name: "移动到..." }));
    const dialog = screen.getByRole("dialog", { name: "移动连接" });
    fireEvent.change(within(dialog).getByLabelText("目标目录"), { target: { value: mockFolders[1].id } });
    fireEvent.click(within(dialog).getByRole("button", { name: "移动" }));

    await waitFor(() => expect(moveConnection).toHaveBeenCalledWith(mockConnections[0].id, mockFolders[1].id));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "移动连接" })).not.toBeInTheDocument();
  });

  it("requires an in-app confirmation before deleting a server", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const deleteConnection = vi.spyOn(api, "deleteConnection").mockResolvedValue(undefined);
    const nativeConfirm = vi.spyOn(window, "confirm");
    useAppStore.setState({
      connectionManagerOpen: true,
      connections: mockConnections,
      folders: mockFolders,
      refreshConnections: refresh,
    });
    render(<ConnectionManager />);

    fireEvent.contextMenu(screen.getByText(mockConnections[0].name).closest("tr")!, { clientX: 120, clientY: 160 });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("button", { name: "删除" }));

    const dialog = screen.getByRole("dialog", { name: "删除连接" });
    expect(deleteConnection).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleteConnection).toHaveBeenCalledWith(mockConnections[0].id));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "删除连接" })).not.toBeInTheDocument();
  });
});
