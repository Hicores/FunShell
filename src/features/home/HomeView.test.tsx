import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { mockConnections, mockFolders } from "../../lib/mock";
import { useAppStore } from "../../stores/appStore";
import { HomeView } from "./HomeView";

describe("HomeView", () => {
  it("expands and collapses quick-connect folders while preserving state across search", () => {
    useAppStore.setState({ connections: mockConnections, folders: mockFolders, quickConnectionCollapsedFolderIds: [] });
    render(<HomeView />);

    const productionFolder = screen.getByRole("button", { name: /生产环境，2 个连接/ });
    expect(productionFolder).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("模块-腾讯云Gateway")).toBeInTheDocument();
    expect(screen.getByText("模块-边缘网关")).toBeInTheDocument();

    fireEvent.click(productionFolder);
    expect(productionFolder).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("模块-腾讯云Gateway")).not.toBeInTheDocument();
    expect(screen.queryByText("模块-边缘网关")).not.toBeInTheDocument();

    const search = screen.getByPlaceholderText("搜索名称、IP 或用户");
    fireEvent.change(search, { target: { value: "腾讯云" } });
    expect(screen.getByRole("button", { name: /生产环境，1 个连接/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("模块-腾讯云Gateway")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByRole("button", { name: /生产环境，2 个连接/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("模块-腾讯云Gateway")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /生产环境，2 个连接/ }));
    expect(screen.getByText("模块-腾讯云Gateway")).toBeInTheDocument();
    expect(screen.getByText("模块-边缘网关")).toBeInTheDocument();
  });

  it("restores a collapsed folder and persists its next expanded state", async () => {
    const folderId = mockFolders[0].id;
    const saveState = vi.spyOn(api, "saveQuickConnectionCollapsedFolders").mockResolvedValue({
      geoipEnabled: true,
      confirmCloseActiveSessions: true,
      terminalFontFamily: "Consolas, monospace",
      terminalFontSize: 13,
      terminalScrollbackLines: 3000,
      quickConnectionCollapsedFolderIds: [],
    });
    useAppStore.setState({
      connections: mockConnections,
      folders: mockFolders,
      quickConnectionCollapsedFolderIds: [folderId],
    });
    render(<HomeView />);

    const productionFolder = screen.getByRole("button", { name: /生产环境，2 个连接/ });
    expect(productionFolder).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(productionFolder);

    expect(productionFolder).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(saveState).toHaveBeenCalledWith([]));
  });

  it("connects from a quick-connect item with one click", () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      connections: mockConnections,
      folders: mockFolders,
      quickConnectionCollapsedFolderIds: [],
      connect,
    });
    render(<HomeView />);

    fireEvent.click(screen.getByText(mockConnections[0].name).closest("button")!);

    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith(mockConnections[0]);
  });
});
