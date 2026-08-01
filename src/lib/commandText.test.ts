import { describe, expect, it } from "vitest";
import { commandHistoryPreview, normalizeCommandText } from "./commandText";

describe("command text", () => {
  it("normalizes CRLF and keeps internal line breaks", () => {
    expect(normalizeCommandText("printf a\r\nprintf b\r\n")).toBe("printf a\nprintf b");
  });

  it("renders multiline history as a compact single-row preview", () => {
    expect(commandHistoryPreview("printf a\nprintf b")).toBe("printf a  ↵  printf b");
  });
});
