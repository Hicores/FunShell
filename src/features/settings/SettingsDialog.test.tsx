import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import { SettingsDialog } from "./SettingsDialog";

describe("SettingsDialog vault flow", () => {
  it("sets a master password with an in-app dialog", async () => {
    vi.spyOn(api, "vaultStatus")
      .mockResolvedValueOnce({ mode: "dpapi", initialized: false, unlocked: true })
      .mockResolvedValueOnce({ mode: "master_password", initialized: true, unlocked: true });
    const changeMode = vi.spyOn(api, "changeVaultMode").mockResolvedValue(undefined);
    const nativePrompt = vi.spyOn(window, "prompt");
    useAppStore.setState({ settingsOpen: true, connections: [], proxies: [], routes: [] });
    render(<SettingsDialog />);

    fireEvent.click(screen.getByRole("button", { name: "凭据保险库" }));
    fireEvent.click(await screen.findByRole("button", { name: "设置主密码保险库" }));
    const dialog = screen.getByRole("dialog", { name: "设置主密码保险库" });
    fireEvent.change(within(dialog).getByLabelText("主密码（至少 9 个字符）"), { target: { value: "portable password" } });
    fireEvent.change(within(dialog).getByLabelText("确认主密码"), { target: { value: "portable password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "启用" }));

    await waitFor(() => expect(changeMode).toHaveBeenCalledWith("master_password", "portable password"));
    expect(nativePrompt).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "设置主密码保险库" })).not.toBeInTheDocument();
  });
});
