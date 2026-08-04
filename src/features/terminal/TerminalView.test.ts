import { describe, expect, it, vi } from "vitest";
import { scheduleTerminalFocus, shouldWriteTerminalStatus, terminalContextAction } from "./TerminalView";

describe("terminalContextAction", () => {
  it("offers copy when the terminal has a selection", () => {
    expect(terminalContextAction("echo FunShell", "clipboard text")).toBe("copy");
  });

  it("offers paste only when the selection is empty and clipboard has text", () => {
    expect(terminalContextAction("", "clipboard text")).toBe("paste");
    expect(terminalContextAction("", "")).toBeNull();
  });
});

describe("scheduleTerminalFocus", () => {
  it("restores focus after the context menu click has finished", () => {
    const focus = vi.fn();
    const callbacks: Array<() => void> = [];

    scheduleTerminalFocus(() => ({ focus }), (callback) => callbacks.push(callback));
    expect(focus).not.toHaveBeenCalled();
    callbacks[0]();
    expect(focus).toHaveBeenCalledOnce();
  });
});

describe("shouldWriteTerminalStatus", () => {
  it("keeps successful connection notices out of the remote shell stream", () => {
    expect(shouldWriteTerminalStatus("connected")).toBe(false);
    expect(shouldWriteTerminalStatus("reconnected")).toBe(false);
    expect(shouldWriteTerminalStatus("reconnecting")).toBe(true);
    expect(shouldWriteTerminalStatus("disconnected")).toBe(true);
    expect(shouldWriteTerminalStatus("error")).toBe(true);
  });
});
