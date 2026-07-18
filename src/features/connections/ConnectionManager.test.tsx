import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
