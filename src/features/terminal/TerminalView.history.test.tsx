import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../../lib/ipc";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { CommandHistoryEntry, WorkspaceTab } from "../../types";
import { CommandPanel } from "./CommandPanel";
import { TerminalView } from "./TerminalView";

const terminalInput = vi.hoisted(() => ({ send: (_data: string) => {}, line: "", column: 0 }));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = {};
    cols = 120;
    rows = 32;
    buffer = { active: {
      type: "normal", baseY: 0, cursorY: 0,
      get cursorX() { return terminalInput.column; },
      getLine: () => ({ isWrapped: false, translateToString: (_trim: boolean, start: number) => terminalInput.line.slice(start) }),
    } };
    registerMarker() { return { line: 0, isDisposed: false, dispose() { this.isDisposed = true; } }; }
    loadAddon() {}
    open() {}
    write(_data: string | Uint8Array, callback?: () => void) { callback?.(); }
    writeln() {}
    dispose() {}
    onData(callback: (data: string) => void) {
      terminalInput.send = callback;
      return { dispose() {} };
    }
    onResize() { return { dispose() {} }; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));

const tab: WorkspaceTab = {
  id: "terminal-history", sessionId: "session-history", connectionId: "connection-history",
  title: "History", kind: "terminal", state: "connected",
};

function entry(command: string): CommandHistoryEntry {
  return { id: command, connectionId: tab.connectionId, command, favorite: false, executedAt: "2026-10-18T10:00:00Z" };
}

describe("direct terminal command history", () => {
  let entries: CommandHistoryEntry[];

  beforeEach(() => {
    entries = [];
    terminalInput.line = "";
    terminalInput.column = 0;
    useAppStore.setState({ connections: [], toast: null });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(ipc, "isTauri").mockReturnValue(true);
    vi.spyOn(ipc, "onEvent").mockResolvedValue(() => {});
    vi.spyOn(api, "getSettings").mockResolvedValue({
      geoipEnabled: true, confirmCloseActiveSessions: true,
      terminalFontFamily: "Consolas", terminalFontSize: 13, terminalScrollbackLines: 3000,
      quickConnectionCollapsedFolderIds: [], processSortKey: "pid", processSortDirection: "asc", theme: "system",
    });
    vi.spyOn(api, "terminalInput").mockResolvedValue(undefined);
    vi.spyOn(api, "resizeTerminal").mockResolvedValue(undefined);
    vi.spyOn(api, "presets").mockResolvedValue([]);
    vi.spyOn(api, "history").mockImplementation(async () => [...entries]);
    vi.spyOn(api, "recordHistory").mockImplementation(async (_connectionId, command) => {
      entries = [entry(command), ...entries.filter((item) => item.command !== command)];
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("saves direct keystrokes after Enter and refreshes both history views", async () => {
    render(<><TerminalView tab={tab} active /><CommandPanel tab={tab} /></>);
    await screen.findByText("尚无命令历史");

    act(() => {
      for (const character of "echo hello") terminalInput.send(character);
    });
    expect(api.recordHistory).not.toHaveBeenCalled();
    act(() => terminalInput.send("\r"));

    expect(await screen.findByRole("button", { name: "echo hello" })).toBeInTheDocument();
    expect(api.recordHistory).toHaveBeenCalledExactlyOnceWith(tab.connectionId, "echo hello");
    expect(api.terminalInput).toHaveBeenLastCalledWith(tab.sessionId, window.btoa("\r"));
    const input = screen.getByPlaceholderText("命令输入（Enter 执行，Shift+Enter 换行）");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("echo hello");
  });

  it("records a multiline paste only once and recalls it intact", async () => {
    render(<TerminalView tab={tab} active />);
    await waitFor(() => expect(api.history).toHaveBeenCalledOnce());
    const command = "cat <<'EOF'\nhello\nEOF";
    act(() => terminalInput.send(`\x1b[200~${command}\x1b[201~`));
    expect(api.recordHistory).not.toHaveBeenCalled();
    act(() => terminalInput.send("\r"));
    await waitFor(() => expect(api.history).toHaveBeenCalledTimes(2));

    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue(command);
    expect(api.recordHistory).toHaveBeenCalledExactlyOnceWith(tab.connectionId, command);
  });

  it("uses the remote echo to save a recalled, edited command and refresh history", async () => {
    const prompt = "root@server:~# ";
    terminalInput.line = prompt;
    terminalInput.column = prompt.length;
    render(<><TerminalView tab={tab} active /><CommandPanel tab={tab} /></>);
    await screen.findByText("尚无命令历史");
    act(() => {
      terminalInput.send("\x1b[A");
      terminalInput.send("\x1b[Dart\r");
    });
    expect(api.recordHistory).not.toHaveBeenCalled();
    terminalInput.line = `${prompt}systemctl start server_main`;
    const output = vi.mocked(ipc.onEvent).mock.calls.find(([name]) => name === "terminal-output")![1];
    act(() => output({ event: "terminal-output", id: 1, payload: { sessionId: tab.sessionId, dataBase64: window.btoa("\r\n") } }));

    expect(await screen.findByRole("button", { name: "systemctl start server_main" })).toBeInTheDocument();
    expect(api.recordHistory).toHaveBeenCalledExactlyOnceWith(tab.connectionId, "systemctl start server_main");
    const commandInput = screen.getByPlaceholderText("命令输入（Enter 执行，Shift+Enter 换行）");
    fireEvent.keyDown(commandInput, { key: "ArrowUp" });
    expect(commandInput).toHaveValue("systemctl start server_main");
  });

  it("reports persistence failures while still sending the command to the terminal", async () => {
    vi.mocked(api.recordHistory).mockRejectedValue(new Error("database unavailable"));
    render(<TerminalView tab={tab} active />);
    act(() => terminalInput.send("echo hello\r"));

    await waitFor(() => expect(useAppStore.getState().toast).toContain("保存命令历史失败"));
    expect(api.terminalInput).toHaveBeenCalledWith(tab.sessionId, window.btoa("echo hello\r"));
    expect(api.history).toHaveBeenCalledOnce();
  });

  it("discards unfinished input when the session is replaced", async () => {
    const view = render(<TerminalView tab={tab} active />);
    act(() => terminalInput.send("unfinished"));
    view.rerender(<TerminalView tab={{ ...tab, sessionId: "session-reconnected" }} active />);
    act(() => terminalInput.send("hostname\r"));

    await waitFor(() => expect(api.recordHistory).toHaveBeenCalledExactlyOnceWith(tab.connectionId, "hostname"));
    expect(api.terminalInput).toHaveBeenLastCalledWith("session-reconnected", window.btoa("hostname\r"));
  });

  it("keeps new history when an older initial read finishes late", async () => {
    let finishInitialRead!: (entries: CommandHistoryEntry[]) => void;
    vi.mocked(api.history).mockImplementationOnce(() => new Promise((resolve) => { finishInitialRead = resolve; }));
    render(<TerminalView tab={tab} active />);
    act(() => terminalInput.send("hostname\r"));
    await waitFor(() => expect(api.history).toHaveBeenCalledTimes(2));
    await act(async () => finishInitialRead([]));

    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("hostname");
  });
});
