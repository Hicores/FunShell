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
  const connected = tab.state === "connected";
  return (
    <div className="terminal-workspace">
      <div className="terminal-region" style={{ bottom: connected ? (collapsed ? 34 : bottomHeight) : 0 }}>
        <TerminalView tab={tab} active={active} />
      </div>
      {connected && <BottomPanel
        tab={tab}
        height={collapsed ? 34 : bottomHeight}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        onResize={setBottomHeight}
      />}
    </div>
  );
}
