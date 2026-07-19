import { Folder, FolderPlus, KeyRound, Plus, RefreshCw, Search, Server, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ContextMenu } from "../../components/common/ContextMenu";
import { IconButton } from "../../components/common/IconButton";
import { Modal } from "../../components/common/Modal";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { ConnectionFolder, ConnectionProfile } from "../../types";

interface ConnectionContext {
  x: number;
  y: number;
  connection: ConnectionProfile;
}

function folderPath(folder: ConnectionFolder, folders: ConnectionFolder[]) {
  const names: string[] = [];
  const visited = new Set<string>();
  let current: ConnectionFolder | undefined = folder;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? folders.find((candidate) => candidate.id === current?.parentId) : undefined;
  }
  return names.join(" / ");
}

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
  const [context, setContext] = useState<ConnectionContext | null>(null);
  const [moving, setMoving] = useState<ConnectionProfile | null>(null);
  const [moveFolderId, setMoveFolderId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ConnectionProfile | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const filtered = useMemo(
    () => connections.filter((connection) => (
      (!folderId || connection.folderId === folderId)
      && `${connection.name} ${connection.host} ${connection.username}`.toLowerCase().includes(query.toLowerCase())
    )),
    [connections, folderId, query],
  );
  const folderOptions = useMemo(
    () => folders
      .map((folder) => ({ id: folder.id, label: folderPath(folder, folders) }))
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
    [folders],
  );

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    try {
      await api.saveFolder({ id: "", parentId: folderId, name, sortOrder: folders.length, deleted: false });
      setFolderDialogOpen(false);
      setFolderName("");
      await refresh();
    } catch (error) {
      notify(String(error));
    }
  };

  const openFolderDialog = () => {
    setFolderName("");
    setFolderDialogOpen(true);
  };
  const closeManager = () => {
    setFolderDialogOpen(false);
    setContext(null);
    setMoving(null);
    setDeleting(null);
    close(false);
  };
  const openConnection = (connection: ConnectionProfile) => {
    closeManager();
    void connect(connection);
  };
  const requestMove = (connection: ConnectionProfile) => {
    setMoving(connection);
    setMoveFolderId(connection.folderId);
  };

  const moveConnection = async () => {
    if (!moving || moving.folderId === moveFolderId) return;
    setActionBusy(true);
    try {
      await api.moveConnection(moving.id, moveFolderId);
      await refresh();
      setSelected(null);
      setMoving(null);
      notify("连接已移动");
    } catch (error) {
      notify(String(error));
    } finally {
      setActionBusy(false);
    }
  };

  const deleteConnection = async () => {
    if (!deleting) return;
    setActionBusy(true);
    try {
      await api.deleteConnection(deleting.id);
      await refresh();
      setSelected(null);
      setDeleting(null);
      notify("连接已移入已删除项目");
    } catch (error) {
      notify(String(error));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} title="连接管理器" width={1000} onClose={closeManager} footer={<div className="manager-footer">双击连接立即打开终端</div>}>
        <div className="manager-toolbar">
          <IconButton label="新建连接" onClick={() => editConnection(undefined, folderId)}><Plus size={17} /></IconButton>
          <IconButton label="新建目录" onClick={openFolderDialog}><FolderPlus size={17} /></IconButton>
          <IconButton label="私钥管理" onClick={() => openKeyManager(true)}><KeyRound size={17} /></IconButton>
          <IconButton label="刷新" onClick={() => void refresh()}><RefreshCw size={17} /></IconButton>
          <IconButton label="删除" disabled={!selected} onClick={() => setDeleting(selected)}><Trash2 size={17} /></IconButton>
          <label className="manager-search"><Search size={15} /><input placeholder="搜索连接" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        </div>
        <div className="connection-manager-body">
          <aside className="folder-sidebar">
            <button className={folderId == null ? "active" : ""} type="button" onClick={() => setFolderId(null)}><Folder size={15} />全部连接<span>{connections.length}</span></button>
            {folders.map((folder) => <button key={folder.id} className={folderId === folder.id ? "active" : ""} type="button" onClick={() => setFolderId(folder.id)}><Folder size={15} />{folder.name}<span>{connections.filter((item) => item.folderId === folder.id).length}</span></button>)}
          </aside>
          <div className="connection-table-wrap">
            <table className="data-table connection-table">
              <thead><tr><th>名称</th><th>主机</th><th>端口</th><th>用户</th><th>认证</th></tr></thead>
              <tbody>
                {filtered.map((connection) => (
                  <tr
                    key={connection.id}
                    className={selected?.id === connection.id ? "selected" : ""}
                    onClick={() => setSelected(connection)}
                    onDoubleClick={() => openConnection(connection)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setSelected(connection);
                      setContext({ x: event.clientX, y: event.clientY, connection });
                    }}
                  >
                    <td><Server size={15} /><strong>{connection.name}</strong></td>
                    <td>{connection.host}</td><td>{connection.port}</td><td>{connection.username}</td>
                    <td>{connection.authMethod === "password" ? "密码" : "私钥"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <div className="empty-state">当前目录没有连接</div>}
          </div>
        </div>
        <div className="manager-actions">
          <button type="button" disabled={!selected} onClick={() => selected && editConnection(selected)}>编辑</button>
          <button className="primary-button" type="button" disabled={!selected} onClick={() => selected && openConnection(selected)}>连接</button>
        </div>
      </Modal>

      <Modal open={open && folderDialogOpen} title="新建目录" width={460} onClose={() => setFolderDialogOpen(false)} footer={<><button type="button" onClick={() => setFolderDialogOpen(false)}>取消</button><button className="primary-button" type="button" disabled={!folderName.trim()} onClick={() => void createFolder()}>确定</button></>}>
        <div className="form-grid folder-create-form">
          <label className="wide">目录名称<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && folderName.trim()) void createFolder(); }} /></label>
          <p className="field-note wide">创建位置：{folders.find((folder) => folder.id === folderId)?.name ?? "根目录"}</p>
        </div>
      </Modal>

      <Modal open={open && moving != null} title="移动连接" width={480} onClose={() => { if (!actionBusy) setMoving(null); }} footer={<><button type="button" disabled={actionBusy} onClick={() => setMoving(null)}>取消</button><button className="primary-button" type="button" disabled={actionBusy || moving?.folderId === moveFolderId} onClick={() => void moveConnection()}>移动</button></>}>
        <div className="form-grid connection-action-form">
          <p className="field-note wide">连接：{moving?.name}</p>
          <label className="wide">目标目录<select value={moveFolderId ?? ""} onChange={(event) => setMoveFolderId(event.target.value || null)}><option value="">根目录</option>{folderOptions.map((folder) => <option key={folder.id} value={folder.id}>{folder.label}</option>)}</select></label>
        </div>
      </Modal>

      <Modal open={open && deleting != null} title="删除连接" width={460} onClose={() => { if (!actionBusy) setDeleting(null); }} footer={<><button type="button" disabled={actionBusy} onClick={() => setDeleting(null)}>取消</button><button className="danger-button" type="button" disabled={actionBusy} onClick={() => void deleteConnection()}>删除</button></>}>
        <p className="connection-delete-message">确定将连接 <strong>{deleting?.name}</strong> 移入已删除项目？</p>
      </Modal>

      {open && context && (
        <ContextMenu x={context.x} y={context.y} onClose={() => setContext(null)}>
          <button type="button" onClick={() => openConnection(context.connection)}>连接</button>
          <button type="button" onClick={() => editConnection(context.connection)}>编辑</button>
          <button type="button" onClick={() => requestMove(context.connection)}>移动到...</button>
          <hr />
          <button className="danger" type="button" onClick={() => setDeleting(context.connection)}>删除</button>
        </ContextMenu>
      )}
    </>
  );
}
