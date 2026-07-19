import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { VaultUnlockGate } from "./VaultUnlockGate";

describe("VaultUnlockGate", () => {
  it("does not prompt when DPAPI auto-unlock succeeds", async () => {
    const status = vi.spyOn(api, "vaultStatus").mockResolvedValue({ mode: "master_password", initialized: true, unlocked: true });
    render(<VaultUnlockGate />);

    await waitFor(() => expect(status).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "解锁凭据保险库" })).not.toBeInTheDocument();
  });

  it("prompts for the master password when DPAPI auto-unlock did not succeed", async () => {
    vi.spyOn(api, "vaultStatus").mockResolvedValue({ mode: "master_password", initialized: true, unlocked: false });
    const unlock = vi.spyOn(api, "unlockMasterVault").mockResolvedValue(undefined);
    render(<VaultUnlockGate />);

    const dialog = await screen.findByRole("dialog", { name: "解锁凭据保险库" });
    expect(within(dialog).queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("主密码（至少 9 个字符）"), { target: { value: "portable password" } });
    fireEvent.click(screen.getByRole("button", { name: "解锁" }));

    await waitFor(() => expect(unlock).toHaveBeenCalledWith("portable password"));
    expect(screen.queryByRole("dialog", { name: "解锁凭据保险库" })).not.toBeInTheDocument();
  });

  it("keeps the unlock prompt open after a wrong password", async () => {
    vi.spyOn(api, "vaultStatus").mockResolvedValue({ mode: "master_password", initialized: true, unlocked: false });
    vi.spyOn(api, "unlockMasterVault").mockRejectedValue(new Error("decrypt"));
    render(<VaultUnlockGate />);

    await screen.findByRole("dialog", { name: "解锁凭据保险库" });
    fireEvent.change(screen.getByLabelText("主密码（至少 9 个字符）"), { target: { value: "wrong password" } });
    fireEvent.click(screen.getByRole("button", { name: "解锁" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("主密码错误，请重新输入");
    expect(screen.getByRole("dialog", { name: "解锁凭据保险库" })).toBeInTheDocument();
  });
});
