export function normalizeCommandText(command: string) {
  return command.replace(/\r\n?/g, "\n").trimEnd();
}

export function commandHistoryPreview(command: string) {
  return normalizeCommandText(command).replace(/\n/g, "  \u21b5  ");
}
