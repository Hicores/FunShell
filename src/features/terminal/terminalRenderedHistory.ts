import type { IMarker, Terminal } from "@xterm/xterm";
import { normalizeCommandText } from "../../lib/commandText";
import { captureTerminalHistoryInput, createTerminalHistoryCaptureState } from "./terminalHistoryCapture";

interface PromptAnchor {
  marker?: IMarker;
  column: number;
  canceled: boolean;
  needsRenderedCommand: boolean;
}

interface PendingCommand {
  anchor: PromptAnchor;
  record: (command: string) => void;
}

// Readline history and completion are resolved by the remote shell. Capture its
// rendered line before the echoed Enter advances to command output, using xterm
// itself to interpret cursor movements, erasures, UTF-8 and wrapped lines.
export class TerminalRenderedHistory {
  private inputState = createTerminalHistoryCaptureState();
  private active: PromptAnchor | null = null;
  private anchors = new Set<PromptAnchor>();
  private pending: PendingCommand[] = [];

  constructor(private readonly terminal: Pick<Terminal, "buffer" | "registerMarker" | "write">) {}

  input(data: string, record: (command: string) => void) {
    if (this.terminal.buffer.active.type === "alternate") {
      this.reset();
      return;
    }
    if (!this.active) {
      const anchor: PromptAnchor = { column: 0, canceled: false, needsRenderedCommand: false };
      this.active = anchor;
      this.anchors.add(anchor);
      // Queue behind already received output, before this input is sent to SSH.
      this.terminal.write("", () => {
        if (anchor.canceled) return;
        anchor.column = this.terminal.buffer.active.cursorX;
        anchor.marker = this.terminal.registerMarker(0);
      });
    }
    const anchor = this.active;
    const wasPasting = this.inputState.bracketedPaste;
    const captured = captureTerminalHistoryInput(this.inputState, data);
    this.inputState = captured.state;
    if (!wasPasting && !data.includes("\x1b[200~") && /[\x1b\t\x01\x02\x04\x05\x06\x08\x0b\x0e\x10\x12\x14]/.test(data)) {
      anchor.needsRenderedCommand = true;
    }
    if (data.includes("\x03")) {
      this.release(anchor);
      this.active = null;
      return;
    }
    if (!captured.submitted) return;
    this.active = null;
    if (anchor.needsRenderedCommand && !captured.command?.includes("\n")) {
      this.pending.push({ anchor, record });
    } else {
      this.release(anchor);
      if (captured.command) record(captured.command);
    }
  }

  output(data: Uint8Array) {
    let start = 0;
    while (this.pending.length > 0) {
      const newline = data.indexOf(10, start);
      if (newline < 0) break;
      const command = this.pending.shift()!;
      this.terminal.write(data.subarray(start, newline), () => {
        if (command.anchor.canceled) return;
        const rendered = this.readCommand(command.anchor);
        this.release(command.anchor);
        if (rendered?.trim()) command.record(rendered);
      });
      this.terminal.write(data.subarray(newline, newline + 1));
      start = newline + 1;
    }
    if (start < data.length) this.terminal.write(data.subarray(start));
  }

  reset() {
    for (const anchor of this.anchors) this.release(anchor);
    this.pending = [];
    this.active = null;
    this.inputState = createTerminalHistoryCaptureState();
  }

  private readCommand(anchor: PromptAnchor) {
    const buffer = this.terminal.buffer.active;
    const marker = anchor.marker;
    if (!marker || marker.isDisposed || buffer.type !== "normal") return null;
    const lastRow = buffer.baseY + buffer.cursorY;
    if (marker.line > lastRow) return null;
    let command = "";
    for (let row = marker.line; row <= lastRow; row++) {
      const line = buffer.getLine(row);
      if (!line) return null;
      if (row > marker.line && !line.isWrapped) command += "\n";
      command += line.translateToString(row === lastRow, row === marker.line ? anchor.column : 0);
    }
    return normalizeCommandText(command);
  }

  private release(anchor: PromptAnchor) {
    anchor.canceled = true;
    anchor.marker?.dispose();
    this.anchors.delete(anchor);
  }
}
