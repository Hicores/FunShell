import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../../lib/ipc";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { WorkspaceTab } from "../../types";
import { TerminalView } from "./TerminalView";

const terminalState = vi.hoisted(() => ({ selection: "selected filename.txt", clear: vi.fn(), paste: vi.fn() }));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = {};
    cols = 120;
    rows = 32;
    textarea?: HTMLTextAreaElement;
    loadAddon() {}
    open(host: HTMLElement) {
      this.textarea = document.createElement("textarea");
      this.textarea.className = "xterm-helper-textarea";
      host.append(this.textarea);
      this.textarea.focus();
    }
    onData() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    hasSelection() { return !!terminalState.selection; }
    getSelection() { return terminalState.selection; }
    clearSelection() { terminalState.clear(); terminalState.selection = ""; }
    paste(text: string) { terminalState.paste(text); }
    focus() { this.textarea?.focus(); }
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));

const tab: WorkspaceTab = {
  id: "terminal-copy", sessionId: "session-copy", connectionId: "connection-copy",
  title: "Copy", kind: "terminal", state: "connected",
};

describe("terminal context clipboard actions", () => {
  beforeEach(() => {
    terminalState.selection = "selected filename.txt";
    terminalState.clear.mockClear();
    terminalState.paste.mockClear();
    useAppStore.setState({ toast: null });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(ipc, "isTauri").mockReturnValue(true);
    vi.spyOn(ipc, "onEvent").mockResolvedValue(() => {});
    vi.spyOn(api, "resizeTerminal").mockResolvedValue(undefined);
    vi.spyOn(api, "history").mockResolvedValue([]);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockResolvedValue("clipboard text") },
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  function openMenu() {
    const input = document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!;
    fireEvent.contextMenu(input, { clientX: 30, clientY: 40 });
    return input;
  }

  it("keeps the terminal focused so input blur cannot dismiss the menu before click", async () => {
    render(<TerminalView tab={tab} active />);
    const input = openMenu();
    input.addEventListener("blur", () => fireEvent.scroll(input));
    const copy = screen.getByRole("button", { name: "复制文本" });
    // Emulate the browser's default mousedown focus, including xterm's input scroll.
    if (fireEvent.mouseDown(copy)) act(() => copy.focus());
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: "复制文本" })).toBe(copy);
    fireEvent.mouseUp(copy);
    fireEvent.click(copy);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("selected filename.txt"));
    expect(terminalState.clear).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("keeps the copy menu through a hidden textarea's delayed internal scroll", () => {
    render(<TerminalView tab={tab} active />);
    const input = openMenu();
    fireEvent.scroll(input);
    expect(screen.getByRole("button", { name: "复制文本" })).toBeInTheDocument();
  });

  it("ignores an older clipboard read after a fresh selection opens a copy menu", async () => {
    let finishRead!: (text: string) => void;
    vi.mocked(navigator.clipboard.readText).mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    render(<TerminalView tab={tab} active />);
    terminalState.selection = "";
    openMenu();
    terminalState.selection = "new selection";
    openMenu();
    expect(screen.getByRole("button", { name: "复制文本" })).toBeInTheDocument();
    await act(async () => finishRead("old clipboard"));
    fireEvent.click(screen.getByRole("button", { name: "复制文本" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("new selection"));
    expect(terminalState.paste).not.toHaveBeenCalled();
  });

  it("copies the captured selection and clears it only after the write succeeds", async () => {
    let finishWrite!: () => void;
    vi.mocked(navigator.clipboard.writeText).mockImplementation(() => new Promise((resolve) => { finishWrite = resolve; }));
    render(<TerminalView tab={tab} active />);
    openMenu();
    terminalState.selection = "later output selection";
    fireEvent.click(screen.getByRole("button", { name: "复制文本" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("selected filename.txt");
    expect(terminalState.clear).not.toHaveBeenCalled();
    await act(async () => finishWrite());
    expect(terminalState.clear).toHaveBeenCalledOnce();
  });

  it("reports clipboard failures and leaves the selection available to retry", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("clipboard unavailable"));
    render(<TerminalView tab={tab} active />);
    const input = openMenu();
    fireEvent.click(screen.getByRole("button", { name: "复制文本" }));
    await waitFor(() => expect(useAppStore.getState().toast).toContain("复制文本失败"));
    expect(terminalState.clear).not.toHaveBeenCalled();
    expect(terminalState.selection).toBe("selected filename.txt");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});
