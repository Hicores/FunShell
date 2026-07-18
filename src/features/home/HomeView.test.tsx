import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockConnections, mockFolders } from "../../lib/mock";
import { useAppStore } from "../../stores/appStore";
import { HomeView } from "./HomeView";

describe("HomeView", () => {
  it("expands and collapses quick-connect folders while preserving state across search", () => {
    useAppStore.setState({ connections: mockConnections, folders: mockFolders });
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
});
