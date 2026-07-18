import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState, type DragEventHandler, type RefObject } from "react";
import { isTauri } from "../../lib/ipc";

interface DropPoint { x: number; y: number }

export function pointInsideElement(point: DropPoint, element: HTMLElement, scale = window.devicePixelRatio || 1) {
  const bounds = element.getBoundingClientRect();
  const x = point.x / scale;
  const y = point.y / scale;
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function filePaths(event: DragEvent) {
  return Array.from(event.dataTransfer?.files ?? [])
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => Boolean(path));
}

export function useFileDrop<T extends HTMLElement>(targetRef: RefObject<T | null>, enabled: boolean, onPaths: (paths: string[]) => void | Promise<void>, onUnsupported: () => void) {
  const [dropActive, setDropActive] = useState(false);
  const onPathsRef = useRef(onPaths);
  const onUnsupportedRef = useRef(onUnsupported);
  useEffect(() => { onPathsRef.current = onPaths; }, [onPaths]);
  useEffect(() => { onUnsupportedRef.current = onUnsupported; }, [onUnsupported]);

  useEffect(() => {
    if (!enabled || !isTauri()) { setDropActive(false); return; }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent((event) => {
      const payload: DragDropEvent = event.payload;
      if (payload.type === "leave") { setDropActive(false); return; }
      const target = targetRef.current;
      const overTarget = Boolean(target && pointInsideElement(payload.position, target));
      if (payload.type === "drop") {
        setDropActive(false);
        if (overTarget && payload.paths.length) void onPathsRef.current(payload.paths);
      } else {
        setDropActive(overTarget);
      }
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    }).catch(() => setDropActive(false));
    return () => { disposed = true; unlisten?.(); };
  }, [enabled, targetRef]);

  const onDragEnter: DragEventHandler<T> = (event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDropActive(true);
  };
  const onDragOver: DragEventHandler<T> = (event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  };
  const onDragLeave: DragEventHandler<T> = (event) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDropActive(false);
  };
  const onDrop: DragEventHandler<T> = (event) => {
    event.preventDefault();
    setDropActive(false);
    const paths = filePaths(event.nativeEvent);
    if (paths.length) void onPathsRef.current(paths);
    else onUnsupportedRef.current();
  };

  return { dropActive, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
