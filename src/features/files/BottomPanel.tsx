import { ChevronDown, ChevronUp, GripHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceTab } from "../../types";
import { FileManager } from "./FileManager";
import { CommandPanel } from "../terminal/CommandPanel";

interface BottomPanelProps {
  tab: WorkspaceTab;
  height: number;
  collapsed: boolean;
  onToggle: () => void;
  onResize: (height: number) => void;
}

export function BottomPanel({ tab, height, collapsed, onToggle, onResize }: BottomPanelProps) {
  const [view, setView] = useState<"files" | "commands">("files");
  const dragging = useRef(false);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!dragging.current) return;
      onResize(Math.max(190, Math.min(window.innerHeight * 0.58, window.innerHeight - event.clientY + 4)));
    };
    const up = () => { dragging.current = false; document.body.classList.remove("is-resizing"); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [onResize]);

  return (
    <section className={`bottom-panel ${collapsed ? "collapsed" : ""}`} style={{ height }}>
      <button className="panel-resizer" type="button" aria-label="调整面板高度" onMouseDown={() => { dragging.current = true; document.body.classList.add("is-resizing"); }}><GripHorizontal size={16} /></button>
      <header className="bottom-tabs">
        <button className={view === "files" ? "active" : ""} type="button" onClick={() => setView("files")}>文件</button>
        <button className={view === "commands" ? "active" : ""} type="button" onClick={() => setView("commands")}>命令</button>
        <span />
        <button type="button" title={collapsed ? "展开" : "收起"} onClick={onToggle}>{collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      </header>
      <div className="bottom-content" hidden={collapsed}>
        <div className="bottom-view" hidden={view !== "files"}><FileManager tab={tab} /></div>
        <div className="bottom-view" hidden={view !== "commands"}><CommandPanel tab={tab} /></div>
      </div>
    </section>
  );
}
