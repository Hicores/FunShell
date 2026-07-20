import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockConnections, mockFolders } from "../../lib/mock";
import { useAppStore } from "../../stores/appStore";
import { ConnectionEditor } from "./ConnectionEditor";

describe("ConnectionEditor", () => {
  it("defaults new profiles to manual reconnect and enables a retry limit on demand", () => {
    useAppStore.setState({
      connectionEditorOpen: true,
      editingConnection: null,
      newConnectionFolderId: null,
      folders: mockFolders,
      keys: [],
      routes: [],
    });

    render(<ConnectionEditor />);
    fireEvent.click(screen.getByRole("button", { name: "终端" }));

    const autoReconnect = screen.getByRole("checkbox", { name: "断线自动重连" });
    const maximum = screen.getByLabelText("最大重连次数（0 为无限）");
    expect(autoReconnect).not.toBeChecked();
    expect(maximum).toBeDisabled();
    expect(maximum).toHaveValue(0);

    fireEvent.click(autoReconnect);
    expect(maximum).toBeEnabled();
    fireEvent.change(maximum, { target: { value: "5" } });
    expect(maximum).toHaveValue(5);
  });

  it("loads an existing profile and switches authentication controls", () => {
    useAppStore.setState({
      connectionEditorOpen: true,
      editingConnection: mockConnections[0],
      folders: mockFolders,
      keys: [{
        id: "key-1",
        name: "部署密钥",
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:test",
        publicKey: "ssh-ed25519 AAAA",
        createdAt: new Date().toISOString(),
      }],
      routes: [],
      keyManagerOpen: false,
    });

    render(<ConnectionEditor />);

    expect(screen.getByRole("dialog", { name: "编辑连接" })).toBeInTheDocument();
    expect(screen.getByLabelText("名称")).toHaveValue(mockConnections[0].name);
    expect(screen.getByLabelText("主机")).toHaveValue(mockConnections[0].host);
    expect(screen.getByPlaceholderText("留空则保持原密码")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("方法"), { target: { value: "public_key" } });
    expect(screen.getByLabelText("私钥")).toHaveValue("");
    expect(screen.getByRole("option", { name: "部署密钥 (ssh-ed25519)" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "保留中的连接名称" } });
    fireEvent.click(screen.getByRole("button", { name: "密钥管理" }));
    expect(useAppStore.getState().keyManagerOpen).toBe(true);
    expect(screen.getByLabelText("名称")).toHaveValue("保留中的连接名称");
  });
});
