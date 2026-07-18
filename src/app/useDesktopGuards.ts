import { useEffect } from "react";

export function useDesktopGuards() {
  useEffect(() => {
    const blockNativeMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-allow-native-menu]")) return;
      event.preventDefault();
    };
    const blockReload = (event: KeyboardEvent) => {
      const reloadKey = event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r");
      if (reloadKey) event.preventDefault();
    };

    window.addEventListener("contextmenu", blockNativeMenu, { capture: true });
    window.addEventListener("keydown", blockReload, { capture: true });
    return () => {
      window.removeEventListener("contextmenu", blockNativeMenu, { capture: true });
      window.removeEventListener("keydown", blockReload, { capture: true });
    };
  }, []);
}
