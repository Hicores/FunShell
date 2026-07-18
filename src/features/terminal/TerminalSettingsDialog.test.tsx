import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalSettingsDialog } from "./TerminalSettingsDialog";

describe("TerminalSettingsDialog", () => {
  it("edits and saves the terminal font settings", () => {
    const save = vi.fn();
    render(<TerminalSettingsDialog open fontFamily="Consolas, monospace" fontSize={13} saving={false} onFontFamilyChange={vi.fn()} onFontSizeChange={vi.fn()} onClose={vi.fn()} onSave={save} />);

    expect(screen.getByRole("dialog", { name: "终端设置" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(save).toHaveBeenCalledOnce();
  });
});
