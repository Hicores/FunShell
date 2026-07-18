import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu, fitContextMenuToViewport } from "./ContextMenu";

describe("ContextMenu", () => {
  it("flips above the pointer and stays inside the viewport", () => {
    expect(fitContextMenuToViewport(
      { x: 790, y: 580 },
      { width: 180, height: 260 },
      { width: 800, height: 600 },
    )).toEqual({ x: 612, y: 320 });
  });

  it("closes after a menu command is selected", () => {
    const close = vi.fn();
    render(<ContextMenu x={10} y={10} onClose={close}><button type="button">刷新</button></ContextMenu>);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(close).toHaveBeenCalledOnce();
  });
});
