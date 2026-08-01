import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { mockConnections } from "../../lib/mock";
import { useAppStore } from "../../stores/appStore";
import type { CommandHistoryEntry, WorkspaceTab } from "../../types";
import { CommandPanel, resolvePresetVariables } from "./CommandPanel";

const tab: WorkspaceTab = { id: "terminal-history", sessionId: "session-history", connectionId: "connection-history", title: "History", kind: "terminal", state: "connected" };

describe("command preset variables", () => {
  beforeEach(() => {
    useAppStore.setState({ connections: [], toast: null });
  });

  it("asks once per variable and replaces all occurrences", () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("nginx");
    expect(resolvePresetVariables("systemctl restart ${service} && status ${service}"))
      .toBe("systemctl restart nginx && status nginx");
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("stops insertion when variable input is canceled", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    expect(resolvePresetVariables("echo ${value}")).toBeNull();
  });

  it("inserts a clicked history command into the terminal input", async () => {
    vi.spyOn(api, "history").mockResolvedValue([{ id: "history-1", connectionId: tab.connectionId, command: "systemctl status nginx", favorite: false, executedAt: "2026-07-18T10:00:00Z" }]);
    const listener = vi.fn();
    window.addEventListener("funshell-insert-command", listener);
    render(<CommandPanel tab={tab} />);

    const command = await screen.findByRole("button", { name: "systemctl status nginx" });
    fireEvent.click(command);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: { sessionId: tab.sessionId, command: "systemctl status nginx" } }));
    window.removeEventListener("funshell-insert-command", listener);
  });

  it("keeps a multiline history entry intact when inserting it", async () => {
    const command = "cat <<'EOF'\nhello\nEOF";
    vi.spyOn(api, "history").mockResolvedValue([{ id: "history-multiline", connectionId: tab.connectionId, command, favorite: false, executedAt: "2026-07-18T10:00:00Z" }]);
    const listener = vi.fn();
    window.addEventListener("funshell-insert-command", listener);
    render(<CommandPanel tab={tab} />);

    const preview = await screen.findByText("cat <<'EOF' ↵ hello ↵ EOF");
    fireEvent.click(preview.closest("button")!);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: { sessionId: tab.sessionId, command } }));
    window.removeEventListener("funshell-insert-command", listener);
  });

  it("switches between the current server and all server histories", async () => {
    const [current, other] = mockConnections;
    const historyTab = { ...tab, connectionId: current.id, title: current.name };
    const entries: CommandHistoryEntry[] = [
      { id: "history-current", connectionId: current.id, command: "systemctl status nginx", favorite: false, executedAt: "2026-07-18T10:00:00Z" },
      { id: "history-other", connectionId: other.id, command: "docker ps", favorite: false, executedAt: "2026-07-18T09:00:00Z" },
    ];
    const history = vi.spyOn(api, "history").mockImplementation(async (connectionId) => entries.filter((entry) => connectionId == null || entry.connectionId === connectionId));
    vi.spyOn(api, "presets").mockResolvedValue([]);
    useAppStore.setState({ connections: [current, other] });
    render(<CommandPanel tab={historyTab} />);

    await waitFor(() => expect(history).toHaveBeenCalledWith(current.id, ""));
    expect(screen.getByRole("button", { name: "systemctl status nginx" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "docker ps" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "历史记录服务器" }), { target: { value: "__all_history__" } });

    await waitFor(() => expect(history).toHaveBeenCalledWith(undefined, ""));
    expect(screen.getByRole("button", { name: "docker ps" })).toBeInTheDocument();
    expect(screen.getByTitle(`${current.name} (${current.host})`)).toHaveTextContent(current.name);
    expect(screen.getByTitle(`${other.name} (${other.host})`)).toHaveTextContent(other.name);
    expect(screen.getByRole("button", { name: "清空全部" })).toBeInTheDocument();
  });
});
