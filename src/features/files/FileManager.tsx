import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { Ban, Download, File, Folder, FolderPlus, Home, RefreshCw, RotateCcw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, isTauri, onEvent } from "../../lib/ipc";
import { formatBytes, formatMode } from "../../lib/format";
import type { RemoteFileEntry, TransferProgressEvent, WorkspaceTab } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { IconButton } from "../../components/common/IconButton";
import { Modal } from "../../components/common/Modal";
import { ContextMenu } from "../../components/common/ContextMenu";

function joinRemote(base: string, name: string) {
  return base === "/" ? `/${name}` : `${base.replace(/\/$/, "")}/${name}`;
}

function parentRemote(path: string) {
  if (path === "/") return "/";
  const parent = path.replace(/\/$/, "").split("/").slice(0, -1).join("/");
  return parent || "/";
}

export function FileManager({ tab }: { tab: WorkspaceTab }) {
  const notify = useAppStore((state) => state.notify);
  const [path, setPath] = useState("/root");
  const [files, setFiles] = useState<RemoteFileEntry[]>([]);
  const [selected, setSelected] = useState<RemoteFileEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<{ path: string; content: string } | null>(null);
  const [context, setContext] = useState<{ x: number; y: number; file: RemoteFileEntry } | null>(null);
  const [transfers, setTransfers] = useState<TransferProgressEvent[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setFiles(await api.remoteFiles(tab.sessionId, path)); }
    catch (error) { notify(String(error)); }
    finally { setLoading(false); }
  }, [notify, path, tab.sessionId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void onEvent<TransferProgressEvent>("transfer-progress", (event) => {
      const task = event.payload;
      if (task.sessionId !== tab.sessionId) return;
      setTransfers((current) => {
        const next = current.filter((item) => item.taskId !== task.taskId);
        return [task, ...next].slice(0, 8);
      });
    }).then((unlisten) => { dispose = unlisten; });
    return () => dispose?.();
  }, [tab.sessionId]);

  const breadcrumbs = useMemo(() => path.split("/").filter(Boolean), [path]);

  const openEntry = async (file: RemoteFileEntry) => {
    if (file.kind === "directory") { setPath(file.path); setSelected(null); return; }
    if (!isTauri()) return notify(`演示模式：打开 ${file.path}`);
    try {
      const localPath = await api.openRemoteFile(tab.sessionId, file.path);
      await openPath(localPath);
    } catch (error) { notify(String(error)); }
  };

  const editEntry = async (file: RemoteFileEntry) => {
    try {
      const value = await api.readRemoteText(tab.sessionId, file.path);
      setEditor({ path: file.path, content: value.content });
    } catch (error) { notify(String(error)); }
  };

  const uploadFiles = async () => {
    if (!isTauri()) return notify("桌面程序中可选择本地文件上传");
    const picked = await open({ multiple: true, directory: false });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    for (const localPath of paths) {
      const name = localPath.replaceAll("\\", "/").split("/").at(-1) ?? "upload.bin";
      await api.uploadRemoteFile(tab.sessionId, localPath, joinRemote(path, name));
    }
    await refresh();
  };

  const downloadFile = async (file: RemoteFileEntry) => {
    if (file.kind === "directory") return notify("目录请使用打包传输");
    if (!isTauri()) return notify(`演示模式：下载 ${file.name}`);
    const localPath = await save({ defaultPath: file.name });
    if (localPath) await api.downloadRemoteFile(tab.sessionId, file.path, localPath);
  };

  const createFolder = async () => {
    const name = window.prompt("新目录名称");
    if (!name?.trim()) return;
    try { await api.createRemoteDirectory(tab.sessionId, joinRemote(path, name.trim())); await refresh(); }
    catch (error) { notify(String(error)); }
  };

  const rename = async (file: RemoteFileEntry) => {
    const name = window.prompt("新名称", file.name);
    if (!name?.trim() || name === file.name) return;
    try { await api.renameRemotePath(tab.sessionId, file.path, joinRemote(path, name.trim())); await refresh(); }
    catch (error) { notify(String(error)); }
  };

  const remove = async (file: RemoteFileEntry) => {
    if (!window.confirm(`确认删除 ${file.path}？`)) return;
    try { await api.deleteRemotePath(tab.sessionId, file.path, file.kind === "directory", file.kind === "directory"); await refresh(); }
    catch (error) { notify(String(error)); }
  };

  const chmod = async (file: RemoteFileEntry) => {
    const next = window.prompt("权限（八进制）", formatMode(file.permissions));
    if (!next || !/^[0-7]{3,4}$/.test(next)) return;
    try { await api.chmodRemotePath(tab.sessionId, file.path, Number.parseInt(next, 8)); await refresh(); }
    catch (error) { notify(String(error)); }
  };

  const retryTransfer = async (task: TransferProgressEvent) => {
    try {
      if (task.direction === "upload") await api.uploadRemoteFile(tab.sessionId, task.source, task.destination);
      else await api.downloadRemoteFile(tab.sessionId, task.source, task.destination);
    } catch (error) { notify(String(error)); }
  };

  return (
    <div className="file-manager">
      <div className="file-tree">
        <div className="tree-title"><Folder size={15} /> /</div>
        {["root", "etc", "home", "opt", "tmp", "var", "usr"].map((name) => (
          <button key={name} className={path === `/${name}` ? "active" : ""} type="button" onClick={() => setPath(`/${name}`)}><Folder size={14} />{name}</button>
        ))}
      </div>
      <div className="file-browser">
        <div className="file-toolbar">
          <div className="breadcrumbs">
            <button type="button" onClick={() => setPath("/")}><Home size={14} /></button>
            {breadcrumbs.map((part, index) => <button key={`${part}-${index}`} type="button" onClick={() => setPath(`/${breadcrumbs.slice(0, index + 1).join("/")}`)}>{part}</button>)}
          </div>
          <IconButton label="上级目录" onClick={() => setPath(parentRemote(path))}><Folder size={16} /></IconButton>
          <IconButton label="刷新" onClick={() => void refresh()}><RefreshCw size={16} className={loading ? "spin" : ""} /></IconButton>
          <IconButton label="新建目录" onClick={() => void createFolder()}><FolderPlus size={16} /></IconButton>
          <IconButton label="上传" onClick={() => void uploadFiles()}><Upload size={16} /></IconButton>
          <IconButton label="下载" disabled={!selected} onClick={() => selected && void downloadFile(selected)}><Download size={16} /></IconButton>
          <IconButton label="删除" disabled={!selected} onClick={() => selected && void remove(selected)}><Trash2 size={16} /></IconButton>
        </div>
        <div className="file-table-wrap">
          <table className="data-table file-table">
            <thead><tr><th>文件名</th><th>大小</th><th>类型</th><th>修改时间</th><th>权限</th><th>用户/用户组</th></tr></thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.path} className={selected?.path === file.path ? "selected" : ""} onClick={() => setSelected(file)} onDoubleClick={() => void openEntry(file)} onContextMenu={(event) => { event.preventDefault(); setSelected(file); setContext({ x: event.clientX, y: event.clientY, file }); }}>
                  <td><span className={`file-icon ${file.kind}`}>{file.kind === "directory" ? <Folder size={16} /> : <File size={16} />}</span>{file.name}</td>
                  <td>{file.kind === "directory" ? "" : formatBytes(file.size)}</td><td>{file.kind === "directory" ? "文件夹" : file.kind === "symlink" ? "链接" : "文件"}</td>
                  <td>{file.modified ? new Date(file.modified * 1000).toLocaleString() : "-"}</td><td>{formatMode(file.permissions)}</td><td>{file.user ?? "-"}/{file.group ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {transfers.length > 0 && <div className="transfer-queue">
          {transfers.map((task) => <div key={task.taskId} className={`transfer-task ${task.state}`}><span>{task.direction === "upload" ? "上传" : "下载"}</span><strong title={task.destination}>{task.destination.replaceAll("\\", "/").split("/").at(-1)}</strong><progress max={Math.max(task.total, 1)} value={task.transferred} /><em>{task.state === "completed" ? "完成" : task.state === "canceled" ? "已取消" : task.state === "error" ? "失败" : `${formatBytes(task.transferred)} / ${formatBytes(task.total)}`}</em>{task.state === "running" ? <IconButton label="取消传输" onClick={() => void api.cancelTransfer(task.taskId)}><Ban size={14} /></IconButton> : task.state !== "completed" ? <IconButton label="重试传输" onClick={() => void retryTransfer(task)}><RotateCcw size={14} /></IconButton> : <span />}</div>)}
        </div>}
      </div>
      {context && (
        <ContextMenu x={context.x} y={context.y} onClose={() => setContext(null)}>
          <button type="button" onClick={() => void refresh()}>刷新</button>
          <button type="button" onClick={() => void openEntry(context.file)}>打开</button>
          {context.file.kind === "file" && <button type="button" onClick={() => void editEntry(context.file)}>文本编辑</button>}
          <button type="button" onClick={() => void navigator.clipboard.writeText(context.file.path)}>复制路径</button>
          <button type="button" onClick={() => void downloadFile(context.file)}>下载</button>
          <button type="button" onClick={() => void uploadFiles()}>上传</button>
          <hr />
          <button type="button" onClick={() => void rename(context.file)}>重命名</button>
          <button type="button" className="danger" onClick={() => void remove(context.file)}>删除</button>
          <button type="button" onClick={() => void chmod(context.file)}>文件权限...</button>
        </ContextMenu>
      )}
      <Modal open={editor != null} title={`远程编辑 - ${editor?.path ?? ""}`} width={900} onClose={() => setEditor(null)} footer={<><button type="button" onClick={() => setEditor(null)}>取消</button><button className="primary-button" type="button" onClick={async () => { if (!editor) return; await api.writeRemoteText(tab.sessionId, editor.path, editor.content); setEditor(null); notify("文件已保存"); }}>保存</button></>}>
        <textarea className="remote-editor" value={editor?.content ?? ""} onChange={(event) => setEditor((current) => current ? { ...current, content: event.target.value } : null)} spellCheck={false} />
      </Modal>
    </div>
  );
}
