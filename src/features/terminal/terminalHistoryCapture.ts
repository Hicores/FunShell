import { normalizeCommandText } from "../../lib/commandText";

export interface TerminalHistoryCaptureState {
  line: string;
  pendingLines: string[];
  escapeSequence: string | null;
  bracketedPaste: boolean;
}

export function createTerminalHistoryCaptureState(): TerminalHistoryCaptureState {
  return { line: "", pendingLines: [], escapeSequence: null, bracketedPaste: false };
}

export function captureTerminalHistoryInput(current: TerminalHistoryCaptureState, data: string) {
  const state: TerminalHistoryCaptureState = {
    line: current.line,
    pendingLines: [...current.pendingLines],
    escapeSequence: current.escapeSequence,
    bracketedPaste: current.bracketedPaste,
  };
  const completedLines: string[] = [];
  let sawBracketedPaste = state.bracketedPaste;

  for (const character of data.replace(/\r\n/g, "\n")) {
    if (state.escapeSequence != null) {
      state.escapeSequence += character;
      if (/[A-Za-z~]/.test(character)) {
        if (state.escapeSequence === "\x1b[200~") {
          state.bracketedPaste = true;
          sawBracketedPaste = true;
        } else if (state.escapeSequence === "\x1b[201~") {
          state.bracketedPaste = false;
          sawBracketedPaste = true;
        }
        state.escapeSequence = null;
      }
      continue;
    }
    if (character === "\x1b") { state.escapeSequence = "\x1b"; continue; }
    if (character === "\r" || character === "\n") {
      completedLines.push(state.line);
      state.line = "";
      continue;
    }
    if (character === "\u007f") { state.line = state.line.slice(0, -1); continue; }
    if (character === "\u0003") {
      state.line = "";
      state.pendingLines = [];
      continue;
    }
    if (character === "\u0015") { state.line = ""; continue; }
    if (character === "\u0017") { state.line = state.line.replace(/\s*\S+\s*$/, ""); continue; }
    if (character === "\t" || character >= " ") state.line += character;
  }

  if (completedLines.length === 0) return { state, command: null as string | null };
  state.pendingLines.push(...completedLines);
  if (state.bracketedPaste || sawBracketedPaste || state.line) {
    return { state, command: null as string | null };
  }

  const command = normalizeCommandText(state.pendingLines.join("\n"));
  state.pendingLines = [];
  return { state, command: command.trim() ? command : null };
}
