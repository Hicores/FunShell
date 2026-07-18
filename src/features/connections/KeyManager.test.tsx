import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import { KeyManager } from "./KeyManager";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("KeyManager", () => {
  it("selects and imports a local private-key file", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    vi.mocked(openDialog).mockResolvedValue("C:\\Users\\me\\.ssh\\id_ed25519");
    const imported = { id: "key-local", name: "id_ed25519", algorithm: "ssh-ed25519", fingerprint: "SHA256:test", publicKey: "ssh-ed25519 AAAA", createdAt: new Date().toISOString() };
    const importFile = vi.spyOn(api, "importKeyFile").mockResolvedValue(imported);
    const refresh = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ keyManagerOpen: true, keys: [], refreshConnections: refresh });
    render(<KeyManager />);

    fireEvent.click(screen.getByRole("button", { name: "导入私钥" }));
    fireEvent.click(screen.getByRole("button", { name: "选择本地文件" }));

    await waitFor(() => expect(openDialog).toHaveBeenCalledWith({ title: "选择私钥文件", multiple: false, directory: false }));
    expect(screen.getByLabelText("名称")).toHaveValue("id_ed25519");
    expect(screen.getByText("C:\\Users\\me\\.ssh\\id_ed25519")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("私钥口令（可选）"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));

    await waitFor(() => expect(importFile).toHaveBeenCalledWith("id_ed25519", "C:\\Users\\me\\.ssh\\id_ed25519", "secret"));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "导入私钥" })).not.toBeInTheDocument();
  });
});
