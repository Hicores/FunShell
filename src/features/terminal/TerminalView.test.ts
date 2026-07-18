import { describe, expect, it } from "vitest";
import { terminalContextAction } from "./TerminalView";

describe("terminalContextAction", () => {
  it("offers copy when the terminal has a selection", () => {
    expect(terminalContextAction("echo FunShell", "clipboard text")).toBe("copy");
  });

  it("offers paste only when the selection is empty and clipboard has text", () => {
    expect(terminalContextAction("", "clipboard text")).toBe("paste");
    expect(terminalContextAction("", "")).toBeNull();
  });
});
