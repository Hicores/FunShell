import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("stays open when the backdrop is clicked and closes from an explicit control", () => {
    const close = vi.fn();
    render(<Modal open title="配置窗口" onClose={close} footer={<button type="button" onClick={close}>取消</button>}><span>配置内容</span></Modal>);

    const dialog = screen.getByRole("dialog", { name: "配置窗口" });
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.click(dialog.parentElement!);
    expect(close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(close).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("can hide the close control for a blocking prompt", () => {
    render(<Modal open title="解锁" closable={false} onClose={vi.fn()}><span>主密码</span></Modal>);

    expect(screen.getByRole("dialog", { name: "解锁" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
  });
});
