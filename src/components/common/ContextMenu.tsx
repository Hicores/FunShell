import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Point { x: number; y: number }
interface Size { width: number; height: number }

export function fitContextMenuToViewport(anchor: Point, menu: Size, viewport: Size, margin = 8): Point {
  const maximumLeft = Math.max(margin, viewport.width - menu.width - margin);
  const maximumTop = Math.max(margin, viewport.height - menu.height - margin);
  const preferredTop = anchor.y + menu.height > viewport.height - margin
    ? anchor.y - menu.height
    : anchor.y;
  return {
    x: Math.min(Math.max(margin, anchor.x), maximumLeft),
    y: Math.min(Math.max(margin, preferredTop), maximumTop),
  };
}

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Point | null>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    setPosition(fitContextMenuToViewport(
      { x, y },
      { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  }, [x, y]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("click", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: position?.x ?? x, top: position?.y ?? y, visibility: position ? "visible" : "hidden" }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target instanceof Element && event.target.closest("button")) onClose();
      }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
    >
      {children}
    </div>,
    document.body,
  );
}
