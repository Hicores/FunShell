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

  it("ignores internal input and menu scrolling but closes when the surrounding view scrolls", () => {
    const close = vi.fn();
    render(<><textarea aria-label="Terminal input" /><div data-testid="surrounding-view" /><ContextMenu x={10} y={10} onClose={close}><button type="button">复制文本</button></ContextMenu></>);
    fireEvent.scroll(screen.getByRole("textbox", { name: "Terminal input" }));
    fireEvent.scroll(screen.getByRole("menu"));
    fireEvent.scroll(screen.getByRole("button", { name: "复制文本" }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.scroll(screen.getByTestId("surrounding-view"));
    expect(close).toHaveBeenCalledOnce();
  });
});
