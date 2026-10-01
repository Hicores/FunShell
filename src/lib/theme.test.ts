import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, resolveTheme, systemTheme } from "./theme";

function mockMatchMedia(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() { return matches; },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return {
    emit(dark: boolean) {
      matches = dark;
      listeners.forEach((listener) => listener({ matches: dark } as MediaQueryListEvent));
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("color-scheme");
});

describe("theme resolution", () => {
  it("honours explicit modes and reads the system preference for system mode", () => {
    mockMatchMedia(true);
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("system")).toBe("dark");
    expect(systemTheme()).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("applies the requested theme to the document", () => {
    mockMatchMedia(true);
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows Windows light/dark changes while in system mode", () => {
    const media = mockMatchMedia(false);
    const dispose = applyTheme("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    media.emit(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    dispose();
    media.emit(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("stops watching the system preference after an explicit mode", () => {
    const media = mockMatchMedia(false);
    applyTheme("system");
    expect(media.listenerCount()).toBe(1);
    applyTheme("dark");
    expect(media.listenerCount()).toBe(0);
  });
});
