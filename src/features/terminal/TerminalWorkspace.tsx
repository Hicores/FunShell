import { useState } from "react";
import type { WorkspaceTab } from "../../types";
import { TerminalView } from "./TerminalView";
import { BottomPanel } from "../files/BottomPanel";

interface TerminalWorkspaceProps {
  tab: WorkspaceTab;
  active: boolean;
}

export function TerminalWorkspace({ tab, active }: TerminalWorkspaceProps) {
  const [bottomHeight, setBottomHeight] = useState(330);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="terminal-workspace">
      <div className="terminal-region" style={{ bottom: collapsed ? 34 : bottomHeight }}>
        <TerminalView tab={tab} active={active} />
      </div>
      <BottomPanel
        tab={tab}
        height={collapsed ? 34 : bottomHeight}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        onResize={setBottomHeight}
      />
    </div>
  );
}

