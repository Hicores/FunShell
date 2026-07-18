import { FolderOpen, Grid2X2, KeyRound, Menu, Settings } from "lucide-react";
import { IconButton } from "../common/IconButton";
import { useAppStore } from "../../stores/appStore";

export function AppHeader() {
  const openConnectionManager = useAppStore((state) => state.openConnectionManager);
  const openKeyManager = useAppStore((state) => state.openKeyManager);
  const openSettings = useAppStore((state) => state.openSettings);
  const toggleTools = useAppStore((state) => state.toggleTools);
  const toolsOpen = useAppStore((state) => state.toolsOpen);

  return (
    <header className="app-header">
      <div className="brand-mark" aria-label="FunShell">
        <span className="brand-prompt">&gt;_</span>
        <strong>FunShell</strong>
      </div>
      <div className="header-tools">
        <IconButton label="连接管理器" onClick={() => openConnectionManager(true)}><FolderOpen size={19} /></IconButton>
        <IconButton label="私钥管理" onClick={() => openKeyManager(true)}><KeyRound size={18} /></IconButton>
      </div>
      <div className="header-spacer" />
      <IconButton label="工具" active={toolsOpen} onClick={toggleTools}><Grid2X2 size={18} /></IconButton>
      <IconButton label="设置" onClick={() => openSettings(true)}><Settings size={18} /></IconButton>
      <IconButton label="菜单"><Menu size={20} /></IconButton>
    </header>
  );
}

