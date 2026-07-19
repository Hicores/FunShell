import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalSettingsDialog } from "./TerminalSettingsDialog";

describe("TerminalSettingsDialog", () => {
  it("edits and saves the terminal font settings", () => {
    const save = vi.fn();
    const changeScrollbackLines = vi.fn();
    render(<TerminalSettingsDialog open fontFamily="Consolas, monospace" fontSize={13} scrollbackLines={3000} saving={false} onFontFamilyChange={vi.fn()} onFontSizeChange={vi.fn()} onScrollbackLinesChange={changeScrollbackLines} onClose={vi.fn()} onSave={save} />);

    expect(screen.getByRole("dialog", { name: "终端设置" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "滚屏行数" }), { target: { value: "5000" } });
    expect(changeScrollbackLines).toHaveBeenCalledWith(5000);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(save).toHaveBeenCalledOnce();
  });
});
