import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockConnections, mockFolders } from "../../lib/mock";
import { useAppStore } from "../../stores/appStore";
import { ConnectionEditor } from "./ConnectionEditor";

describe("ConnectionEditor", () => {
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
    });

    render(<ConnectionEditor />);

    expect(screen.getByRole("dialog", { name: "编辑连接" })).toBeInTheDocument();
    expect(screen.getByLabelText("名称")).toHaveValue(mockConnections[0].name);
    expect(screen.getByLabelText("主机")).toHaveValue(mockConnections[0].host);
    expect(screen.getByPlaceholderText("留空则保持原密码")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("方法"), { target: { value: "public_key" } });
    expect(screen.getByLabelText("私钥")).toHaveValue("");
    expect(screen.getByRole("option", { name: "部署密钥 (ssh-ed25519)" })).toBeInTheDocument();
  });
});
