import { ChevronDown, ChevronRight, Folder, Search, Server } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "../../stores/appStore";

export function HomeView() {
  const connections = useAppStore((state) => state.connections);
  const folders = useAppStore((state) => state.folders);
  const connect = useAppStore((state) => state.connect);
  const openManager = useAppStore((state) => state.openConnectionManager);
  const [query, setQuery] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const filtered = useMemo(() => connections.filter((item) => `${item.name} ${item.host} ${item.username}`.toLowerCase().includes(query.toLowerCase())), [connections, query]);
  const searchActive = Boolean(query.trim());
  const toggleFolder = (id: string) => setCollapsedFolders((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

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
                <button className="quick-group-title" type="button" aria-expanded={expanded} aria-label={`${folder.name}，${children.length} 个连接`} onClick={() => toggleFolder(folder.id)}>
                  {expanded ? <ChevronDown className="folder-chevron" size={14} /> : <ChevronRight className="folder-chevron" size={14} />}
                  <Folder size={15} /><strong>{folder.name}</strong><span>{children.length}</span>
                </button>
                {expanded && children.map((connection) => (
                  <button key={connection.id} type="button" onDoubleClick={() => void connect(connection)} onClick={() => undefined}>
                    <Server size={15} /><strong>{connection.name}</strong><span>{connection.host}</span><span>{connection.username}</span><ChevronRight size={14} />
                  </button>
                ))}
              </div>
            );
          })}
          {filtered.filter((connection) => !connection.folderId).map((connection) => (
            <button key={connection.id} type="button" onDoubleClick={() => void connect(connection)}>
              <Server size={15} /><strong>{connection.name}</strong><span>{connection.host}</span><span>{connection.username}</span><ChevronRight size={14} />
            </button>
          ))}
          {!filtered.length && <div className="empty-state">没有匹配的连接</div>}
        </div>
      </div>
    </section>
  );
}
