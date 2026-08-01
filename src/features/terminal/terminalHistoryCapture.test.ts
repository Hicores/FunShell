import { describe, expect, it } from "vitest";
import { captureTerminalHistoryInput, createTerminalHistoryCaptureState } from "./terminalHistoryCapture";

describe("terminal history capture", () => {
  it("records a normally typed command after Enter", () => {
    const typed = captureTerminalHistoryInput(createTerminalHistoryCaptureState(), "echo hello");
    const submitted = captureTerminalHistoryInput(typed.state, "\r");
    expect(submitted.command).toBe("echo hello");
  });

  it("stores a bracketed multiline paste as one entry after Enter", () => {
    const pasted = captureTerminalHistoryInput(
      createTerminalHistoryCaptureState(),
      "\x1b[200~cat <<'EOF'\nhello\nEOF\x1b[201~",
    );
    expect(pasted.command).toBeNull();
    const submitted = captureTerminalHistoryInput(pasted.state, "\r");
    expect(submitted.command).toBe("cat <<'EOF'\nhello\nEOF");
  });

  it("keeps an unbracketed multiline paste together", () => {
    const pasted = captureTerminalHistoryInput(createTerminalHistoryCaptureState(), "printf a\nprintf b");
    expect(pasted.command).toBeNull();
    const submitted = captureTerminalHistoryInput(pasted.state, "\n");
    expect(submitted.command).toBe("printf a\nprintf b");
  });

  it("treats a CRLF command batch as one history entry", () => {
    const submitted = captureTerminalHistoryInput(createTerminalHistoryCaptureState(), "printf a\r\nprintf b\r\n");
    expect(submitted.command).toBe("printf a\nprintf b");
  });
});
