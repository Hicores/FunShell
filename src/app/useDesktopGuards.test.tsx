import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDesktopGuards } from "./useDesktopGuards";

function Fixture() {
  useDesktopGuards();
  return <><button>普通区域</button><input data-allow-native-menu aria-label="允许原生菜单" /></>;
}

describe("desktop browser guards", () => {
  it("blocks native context menus unless explicitly allowed", () => {
    const view = render(<Fixture />);
    const regular = view.getByRole("button", { name: "普通区域" });
    const allowed = view.getByRole("textbox", { name: "允许原生菜单" });

    expect(fireEvent.contextMenu(regular)).toBe(false);
    expect(fireEvent.contextMenu(allowed)).toBe(true);
  });

  it("blocks browser reload shortcuts", () => {
    render(<Fixture />);
    expect(fireEvent.keyDown(window, { key: "F5" })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "r", ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "r" })).toBe(true);
  });
});
