import { ChevronRight, Folder, Search, Server } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "../../stores/appStore";

export function HomeView() {
  const connections = useAppStore((state) => state.connections);
  const folders = useAppStore((state) => state.folders);
  const connect = useAppStore((state) => state.connect);
  const openManager = useAppStore((state) => state.openConnectionManager);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => connections.filter((item) => `${item.name} ${item.host} ${item.username}`.toLowerCase().includes(query.toLowerCase())), [connections, query]);

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
            return (
              <div key={folder.id} className="quick-group">
                <div className="quick-group-title"><Folder size={15} />{folder.name}</div>
                {children.map((connection) => (
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
