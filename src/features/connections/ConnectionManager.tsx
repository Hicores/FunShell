import { Folder, FolderPlus, KeyRound, Plus, RefreshCw, Search, Server, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../../components/common/Modal";
import { IconButton } from "../../components/common/IconButton";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { ConnectionProfile } from "../../types";

export function ConnectionManager() {
  const open = useAppStore((state) => state.connectionManagerOpen);
  const close = useAppStore((state) => state.openConnectionManager);
  const connections = useAppStore((state) => state.connections);
  const folders = useAppStore((state) => state.folders);
  const connect = useAppStore((state) => state.connect);
  const editConnection = useAppStore((state) => state.editConnection);
  const refresh = useAppStore((state) => state.refreshConnections);
  const openKeyManager = useAppStore((state) => state.openKeyManager);
  const notify = useAppStore((state) => state.notify);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConnectionProfile | null>(null);
  const [query, setQuery] = useState("");
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const filtered = useMemo(() => connections.filter((connection) => (!folderId || connection.folderId === folderId) && `${connection.name} ${connection.host} ${connection.username}`.toLowerCase().includes(query.toLowerCase())), [connections, folderId, query]);

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    try { await api.saveFolder({ id: "", parentId: folderId, name, sortOrder: folders.length, deleted: false }); setFolderDialogOpen(false); setFolderName(""); await refresh(); }
    catch (error) { notify(String(error)); }
  };

  const openFolderDialog = () => { setFolderName(""); setFolderDialogOpen(true); };
  const closeManager = () => { setFolderDialogOpen(false); close(false); };

  const remove = async () => {
    if (!selected || !window.confirm(`将连接 ${selected.name} 移入已删除项目？`)) return;
    try { await api.deleteConnection(selected.id); setSelected(null); await refresh(); }
    catch (error) { notify(String(error)); }
  };

  return (
    <>
    <Modal open={open} title="连接管理器" width={1000} onClose={closeManager} footer={<div className="manager-footer">双击连接立即打开终端</div>}>
      <div className="manager-toolbar">
        <IconButton label="新建连接" onClick={() => editConnection()}><Plus size={17} /></IconButton>
        <IconButton label="新建目录" onClick={openFolderDialog}><FolderPlus size={17} /></IconButton>
        <IconButton label="私钥管理" onClick={() => openKeyManager(true)}><KeyRound size={17} /></IconButton>
        <IconButton label="刷新" onClick={() => void refresh()}><RefreshCw size={17} /></IconButton>
        <IconButton label="删除" disabled={!selected} onClick={() => void remove()}><Trash2 size={17} /></IconButton>
        <label className="manager-search"><Search size={15} /><input placeholder="搜索连接" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>
      <div className="connection-manager-body">
        <aside className="folder-sidebar">
          <button className={folderId == null ? "active" : ""} type="button" onClick={() => setFolderId(null)}><Folder size={15} />全部连接<span>{connections.length}</span></button>
          {folders.map((folder) => <button key={folder.id} className={folderId === folder.id ? "active" : ""} type="button" onClick={() => setFolderId(folder.id)}><Folder size={15} />{folder.name}<span>{connections.filter((item) => item.folderId === folder.id).length}</span></button>)}
        </aside>
        <div className="connection-table-wrap">
          <table className="data-table connection-table"><thead><tr><th>名称</th><th>主机</th><th>端口</th><th>用户</th><th>认证</th></tr></thead><tbody>{filtered.map((connection) => <tr key={connection.id} className={selected?.id === connection.id ? "selected" : ""} onClick={() => setSelected(connection)} onDoubleClick={() => { close(false); void connect(connection); }} onContextMenu={(event) => { event.preventDefault(); setSelected(connection); editConnection(connection); }}><td><Server size={15} /><strong>{connection.name}</strong></td><td>{connection.host}</td><td>{connection.port}</td><td>{connection.username}</td><td>{connection.authMethod === "password" ? "密码" : "私钥"}</td></tr>)}</tbody></table>
          {!filtered.length && <div className="empty-state">当前目录没有连接</div>}
        </div>
      </div>
      <div className="manager-actions"><button type="button" disabled={!selected} onClick={() => selected && editConnection(selected)}>编辑</button><button className="primary-button" type="button" disabled={!selected} onClick={() => { if (!selected) return; close(false); void connect(selected); }}>连接</button></div>
    </Modal>
    <Modal open={open && folderDialogOpen} title="新建目录" width={460} onClose={() => setFolderDialogOpen(false)} footer={<><button type="button" onClick={() => setFolderDialogOpen(false)}>取消</button><button className="primary-button" type="button" disabled={!folderName.trim()} onClick={() => void createFolder()}>确定</button></>}>
      <div className="form-grid folder-create-form">
        <label className="wide">目录名称<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && folderName.trim()) void createFolder(); }} /></label>
        <p className="field-note wide">创建位置：{folders.find((folder) => folder.id === folderId)?.name ?? "根目录"}</p>
      </div>
    </Modal>
    </>
  );
}
