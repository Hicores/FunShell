import { getCurrentWindow, type Theme } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { isTauri } from "./ipc";
import type { ThemeMode } from "../types";

export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function canMatchMedia() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

export function systemTheme(): ResolvedTheme {
  return canMatchMedia() && window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? systemTheme() : mode;
}

function paint(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

// The webview paints immediately from matchMedia, but the native title bar only follows the
// requested theme, so manual overrides are pushed to the window; "system" resets it to null.
async function syncNativeTheme(theme: Theme | null) {
  if (!isTauri()) return;
  try {
    await getCurrentWindow().setTheme(theme);
  } catch (error) {
    console.warn("无法同步窗口主题", error);
  }
}

let activeSystemListener: (() => void) | null = null;

export function applyTheme(mode: ThemeMode): () => void {
  paint(resolveTheme(mode));
  void syncNativeTheme(mode === "system" ? null : mode);

  activeSystemListener?.();
  activeSystemListener = null;
  let removeListener: (() => void) | null = null;
  if (mode === "system" && canMatchMedia()) {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      paint(systemTheme());
      void syncNativeTheme(null);
    };
    query.addEventListener("change", onChange);
    removeListener = () => query.removeEventListener("change", onChange);
    activeSystemListener = removeListener;
  }
  return () => {
    removeListener?.();
    if (activeSystemListener === removeListener) activeSystemListener = null;
  };
}

/** Applies a stored theme mode and follows later Windows light/dark changes while in "system" mode. */
export function useTheme(mode: ThemeMode) {
  useEffect(() => applyTheme(mode), [mode]);
}
