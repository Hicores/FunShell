import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, Search, Server } from "lucide-react";
import { useMemo, useState } from "react";
import { displayIpAddress } from "../../lib/address";
import { useAppStore } from "../../stores/appStore";

export function HomeView() {
  const connections = useAppStore((state) => state.connections);
  const folders = useAppStore((state) => state.folders);
  const connect = useAppStore((state) => state.connect);
  const openManager = useAppStore((state) => state.openConnectionManager);
  const collapsedFolderIds = useAppStore((state) => state.quickConnectionCollapsedFolderIds);
  const setFolderCollapsed = useAppStore((state) => state.setQuickConnectionFolderCollapsed);
  const [query, setQuery] = useState("");
  const [revealedHosts, setRevealedHosts] = useState<Record<string, boolean>>({});
  const filtered = useMemo(() => connections.filter((item) => `${item.name} ${item.host} ${item.username}`.toLowerCase().includes(query.toLowerCase())), [connections, query]);
  const searchActive = Boolean(query.trim());
  const collapsedFolders = useMemo(() => new Set(collapsedFolderIds), [collapsedFolderIds]);
  const renderConnection = (connection: typeof connections[number]) => {
    const revealed = revealedHosts[connection.id] === true;
    return (
      <div key={connection.id} className="quick-connection-row">
        <button className="quick-connection-main" type="button" onClick={() => void connect(connection)}>
          <Server size={15} /><strong>{connection.name}</strong><span>{displayIpAddress(connection.host, revealed)}</span><span>{connection.username}</span><ChevronRight size={14} />
        </button>
        <button className="quick-connection-eye" type="button" title={revealed ? "隐藏完整 IP" : "显示完整 IP"} aria-label={`${revealed ? "隐藏" : "显示"} ${connection.name} 的完整 IP`} aria-pressed={revealed} onClick={() => setRevealedHosts((current) => ({ ...current, [connection.id]: !revealed }))}>
          {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    );
  };

  return (
    <section className="home-view">
      <div className="quick-connect-panel">
        <header>
          <strong>快速连接</strong>
          <label><Search size={15} /><input placeholder="搜索名称、IP 或用户" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <button type="button" onClick={() => openManager(true)}>管理连接</button>
        </header>
        <div className="quick-connect-list">
          {folders.map((folder) => {
            const children = filtered.filter((connection) => connection.folderId === folder.id);
            if (!children.length) return null;
            const expanded = searchActive || !collapsedFolders.has(folder.id);
            return (
              <div key={folder.id} className="quick-group">
                <button className="quick-group-title" type="button" aria-expanded={expanded} aria-label={`${folder.name}，${children.length} 个连接`} onClick={() => void setFolderCollapsed(folder.id, !collapsedFolders.has(folder.id))}>
                  {expanded ? <ChevronDown className="folder-chevron" size={14} /> : <ChevronRight className="folder-chevron" size={14} />}
                  <Folder size={15} /><strong>{folder.name}</strong><span>{children.length}</span>
                </button>
                {expanded && children.map(renderConnection)}
              </div>
            );
          })}
          {filtered.filter((connection) => !connection.folderId).map(renderConnection)}
          {!filtered.length && <div className="empty-state">没有匹配的连接</div>}
        </div>
      </div>
    </section>
  );
}
