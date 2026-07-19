import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VaultPasswordDialog } from "./VaultPasswordDialog";

describe("VaultPasswordDialog", () => {
  it("requires a matching master password with at least nine characters", () => {
    const submit = vi.fn();
    render(<VaultPasswordDialog open title="设置主密码保险库" mode="create" busy={false} error={null} onClose={vi.fn()} onSubmit={submit} />);

    const enable = screen.getByRole("button", { name: "启用" });
    expect(enable).toBeDisabled();
    fireEvent.change(screen.getByLabelText("主密码（至少 9 个字符）"), { target: { value: "123456789" } });
    fireEvent.change(screen.getByLabelText("确认主密码"), { target: { value: "123456788" } });
    expect(screen.getByText("两次输入的主密码不一致")).toBeInTheDocument();
    expect(enable).toBeDisabled();

    fireEvent.change(screen.getByLabelText("确认主密码"), { target: { value: "123456789" } });
    fireEvent.click(enable);

    expect(submit).toHaveBeenCalledWith("123456789");
  });
});
