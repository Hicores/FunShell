import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceTab } from "../../types";
import { BottomPanel } from "./BottomPanel";

vi.mock("./FileManager", () => ({
  FileManager: () => <label>文件路径<input aria-label="测试文件路径" defaultValue="/root" /></label>,
}));
vi.mock("../terminal/CommandPanel", () => ({
  CommandPanel: () => <label>命令筛选<input aria-label="测试命令筛选" defaultValue="" /></label>,
}));

const tab: WorkspaceTab = {
  id: "bottom-panel-session",
  sessionId: "bottom-panel-session",
  connectionId: "connection-1",
  title: "Server",
  kind: "terminal",
  state: "connected",
};

describe("BottomPanel", () => {
  it("preserves file and command state while switching views", () => {
    render(<BottomPanel tab={tab} height={330} collapsed={false} onToggle={vi.fn()} onResize={vi.fn()} />);
    const filePath = screen.getByLabelText("测试文件路径");
    fireEvent.change(filePath, { target: { value: "/srv/apps" } });

    fireEvent.click(screen.getByRole("button", { name: "命令" }));
    const commandFilter = screen.getByLabelText("测试命令筛选");
    fireEvent.change(commandFilter, { target: { value: "systemctl" } });
    fireEvent.click(screen.getByRole("button", { name: "文件" }));

    expect(screen.getByLabelText("测试文件路径")).toHaveValue("/srv/apps");
    fireEvent.click(screen.getByRole("button", { name: "命令" }));
    expect(screen.getByLabelText("测试命令筛选")).toHaveValue("systemctl");
  });

  it("preserves content state while the bottom panel is collapsed", () => {
    const view = render(<BottomPanel tab={tab} height={330} collapsed={false} onToggle={vi.fn()} onResize={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("测试文件路径"), { target: { value: "/var/log" } });

    view.rerender(<BottomPanel tab={tab} height={34} collapsed onToggle={vi.fn()} onResize={vi.fn()} />);
    view.rerender(<BottomPanel tab={tab} height={330} collapsed={false} onToggle={vi.fn()} onResize={vi.fn()} />);

    expect(screen.getByLabelText("测试文件路径")).toHaveValue("/var/log");
  });
});
