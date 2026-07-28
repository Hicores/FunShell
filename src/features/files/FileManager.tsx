import { open, save } from "@tauri-apps/plugin-dialog";
import { ArrowRight, Download, File, Folder, FolderPlus, Link2, Plus, RefreshCw, Save, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextMenu } from "../../components/common/ContextMenu";
import { IconButton } from "../../components/common/IconButton";
import { Modal } from "../../components/common/Modal";
import { useVirtualRows, VirtualTableSpacer } from "../../components/common/useVirtualRows";
import { formatBytes, formatIdentity, formatMode } from "../../lib/format";
import { api, isTauri } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { RemoteFileEntry, RemoteIdentities, WorkspaceTab } from "../../types";
import { PermissionDialog } from "./PermissionDialog";
import { RemoteDirectoryTree } from "./RemoteDirectoryTree";
import { openRemoteEditorWindow } from "./openEditorWindow";
import { useFileDrop } from "./useFileDrop";

function joinRemote(base: string, name: string) {
  return base === "/" ? `/${name}` : `${base.replace(/\/$/, "")}/${name}`;
}

function parentRemote(path: string) {
  if (path === "/") return "/";
  const parent = path.replace(/\/$/, "").split("/").slice(0, -1).join("/");
  return parent || "/";
}

function normalizeRemoteDirectory(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  const segments: string[] = [];
  for (const segment of trimmed.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

interface EditorDocument {
  path: string;
  content: string;
  dirty: boolean;
}

function remoteFileName(path: string) {
  return path.split("/").at(-1) || path;
}

export function FileManager({ tab }: { tab: WorkspaceTab }) {
  const notify = useAppStore((state) => state.notify);
  const active = useAppStore((state) => state.activeTabId === tab.id);
  const [path, setPath] = useState("/root");
  const [pathInput, setPathInput] = useState("/root");
  const [files, setFiles] = useState<RemoteFileEntry[]>([]);
  const [filesPath, setFilesPath] = useState<string | null>(null);
  const [filesSessionId, setFilesSessionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<RemoteFileEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [editorDocuments, setEditorDocuments] = useState<EditorDocument[]>([]);
  const [activeEditorPath, setActiveEditorPath] = useState<string | null>(null);
  const [editorLoadingPaths, setEditorLoadingPaths] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPickerOpen, setEditorPickerOpen] = useState(false);
  const [permissionFile, setPermissionFile] = useState<RemoteFileEntry | null>(null);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [remoteIdentities, setRemoteIdentities] = useState<RemoteIdentities | null>(null);
  const [identitiesSessionId, setIdentitiesSessionId] = useState<string | null>(null);
  const [identitiesLoading, setIdentitiesLoading] = useState(false);
  const [identitiesError, setIdentitiesError] = useState<string | null>(null);
  const [context, setContext] = useState<{ x: number; y: number; file: RemoteFileEntry | null; targetPath: string } | null>(null);
  const [createDialog, setCreateDialog] = useState<{ kind: "file" | "directory"; name: string; parentPath: string } | null>(null);
  const dropTargetRef = useRef<HTMLDivElement>(null);
  const skipNextRefreshPathRef = useRef<string | null>(null);
  const fileRequestRef = useRef(0);
  const editorRequestRef = useRef(new Map<string, number>());
  const editorRequestSequenceRef = useRef(0);
  const identityRequestRef = useRef(0);
  const editor = editorDocuments.find((document) => document.path === activeEditorPath) ?? editorDocuments[0] ?? null;

  const loadRemoteIdentities = useCallback(async (force = false) => {
    if (!force && identitiesSessionId === tab.sessionId && remoteIdentities) return;
    const requestId = ++identityRequestRef.current;
    const sessionId = tab.sessionId;
    setIdentitiesLoading(true);
    setIdentitiesError(null);
    try {
      const identities = await api.remoteIdentities(sessionId);
      if (identityRequestRef.current !== requestId) return;
      setRemoteIdentities(identities);
      setIdentitiesSessionId(sessionId);
    } catch (error) {
      if (identityRequestRef.current === requestId) setIdentitiesError(String(error));
    } finally {
      if (identityRequestRef.current === requestId) setIdentitiesLoading(false);
    }
  }, [identitiesSessionId, remoteIdentities, tab.sessionId]);

  useEffect(() => {
    if (permissionFile) void loadRemoteIdentities();
  }, [loadRemoteIdentities, permissionFile]);

  const refresh = useCallback(async () => {
    const requestId = ++fileRequestRef.current;
    setLoading(true);
    try {
      const nextFiles = await api.remoteFiles(tab.sessionId, path);
      if (fileRequestRef.current === requestId) {
        setFiles(nextFiles);
        setFilesPath(path);
        setFilesSessionId(tab.sessionId);
      }
    } catch (error) {
      if (fileRequestRef.current === requestId) notify(String(error));
    } finally {
      if (fileRequestRef.current === requestId) setLoading(false);
    }
  }, [notify, path, tab.sessionId]);

  useEffect(() => {
    if (skipNextRefreshPathRef.current === path) {
      skipNextRefreshPathRef.current = null;
      return;
    }
    void refresh();
  }, [path, refresh]);
  useEffect(() => { setPathInput(path); }, [path]);
  const visibleFiles = filesSessionId === tab.sessionId && filesPath === path ? files : [];
  const virtualFiles = useVirtualRows(visibleFiles, 32);

  const navigateToPath = (targetPath: string) => {
    if (targetPath === path) { setPathInput(path); setSelected(null); return; }
    fileRequestRef.current += 1;
    setPath(targetPath);
    setPathInput(targetPath);
    setFiles([]);
    setFilesPath(null);
    setFilesSessionId(null);
    setSelected(null);
  };

  const openTypedPath = async () => {
    const targetPath = normalizeRemoteDirectory(pathInput);
    if (!targetPath) {
      notify("请输入以 / 开头的远程绝对路径");
      setPathInput(path);
      return;
    }
    if (targetPath === path) {
      setPathInput(path);
      await refresh();
      return;
    }
    const requestId = ++fileRequestRef.current;
    setLoading(true);
    try {
      const nextFiles = await api.remoteFiles(tab.sessionId, targetPath);
      if (fileRequestRef.current !== requestId) return;
      skipNextRefreshPathRef.current = targetPath;
      setFiles(nextFiles);
      setFilesPath(targetPath);
      setFilesSessionId(tab.sessionId);
      setPath(targetPath);
      setPathInput(targetPath);
      setSelected(null);
    } catch (error) {
      if (fileRequestRef.current === requestId) { setPathInput(path); notify(String(error)); }
    } finally {
      if (fileRequestRef.current === requestId) setLoading(false);
    }
  };

  const openEntry = async (file: RemoteFileEntry) => {
    if (file.kind === "directory") { navigateToPath(file.path); return; }
    await editEntry(file);
  };

  const editEntry = async (file: RemoteFileEntry) => {
    if (isTauri()) {
      setContext(null);
      await openRemoteEditorWindow(tab.sessionId, file.path, file.name, notify);
      return;
    }
    if (editorDocuments.some((document) => document.path === file.path)) {
      setActiveEditorPath(file.path);
      setEditorOpen(true);
      setContext(null);
      return;
    }
    if (editorLoadingPaths.includes(file.path)) return;
    const requestId = ++editorRequestSequenceRef.current;
    editorRequestRef.current.set(file.path, requestId);
    setContext(null);
    setEditorOpen(true);
    setEditorLoadingPaths((current) => current.includes(file.path) ? current : [...current, file.path]);
    try {
      const value = await api.readRemoteText(tab.sessionId, file.path);
      if (editorRequestRef.current.get(file.path) !== requestId) return;
      setEditorDocuments((current) => current.some((document) => document.path === file.path)
        ? current
        : [...current, { path: file.path, content: value.content, dirty: false }]);
      setActiveEditorPath(file.path);
    } catch (error) {
      if (editorRequestRef.current.get(file.path) === requestId) notify(String(error));
    } finally {
      if (editorRequestRef.current.get(file.path) === requestId) {
        editorRequestRef.current.delete(file.path);
        setEditorLoadingPaths((current) => current.filter((path) => path !== file.path));
      }
    }
  };

  const cancelEditorLoading = (targetPath?: string) => {
    if (targetPath) {
      editorRequestRef.current.delete(targetPath);
      setEditorLoadingPaths((current) => current.filter((path) => path !== targetPath));
      return;
    }
    editorRequestRef.current.clear();
    setEditorLoadingPaths([]);
  };

  const closeEditorDocument = (targetPath: string) => {
    const document = editorDocuments.find((item) => item.path === targetPath);
    if (document?.dirty && !window.confirm(`文件 ${remoteFileName(targetPath)} 有未保存修改，确认关闭？`)) return;
    const remaining = editorDocuments.filter((item) => item.path !== targetPath);
    setEditorDocuments(remaining);
    if (activeEditorPath === targetPath) setActiveEditorPath(remaining[0]?.path ?? null);
    if (!remaining.length && !editorLoadingPaths.length) setEditorOpen(false);
  };

  const updateEditorContent = (targetPath: string, content: string) => {
    setEditorDocuments((current) => current.map((document) => document.path === targetPath ? { ...document, content, dirty: true } : document));
  };

  const saveEditorDocument = async (targetPath: string) => {
    const document = editorDocuments.find((item) => item.path === targetPath);
    if (!document) return;
    try {
      await api.writeRemoteText(tab.sessionId, document.path, document.content);
      setEditorDocuments((current) => current.map((item) => item.path === targetPath ? { ...item, dirty: false } : item));
      notify(`文件 ${remoteFileName(targetPath)} 已保存`);
    } catch (error) {
      notify(String(error));
    }
  };

  const saveAllEditors = async () => {
    for (const document of editorDocuments.filter((item) => item.dirty)) {
      await saveEditorDocument(document.path);
    }
  };

  const closeEditorWorkspace = () => {
    if (editorDocuments.some((document) => document.dirty) && !window.confirm("存在未保存的文件，确认关闭编辑工作区？")) return;
    cancelEditorLoading();
    setEditorPickerOpen(false);
    setEditorOpen(false);
  };

  const uploadPaths = useCallback(async (localPaths: string[], destinationPath = path) => {
    if (!localPaths.length) return;
    for (const localPath of localPaths) {
      const name = localPath.replaceAll("\\", "/").split("/").at(-1) ?? "upload.bin";
      try { await api.uploadRemoteFile(tab.sessionId, localPath, joinRemote(destinationPath, name)); }
      catch (error) { notify(`上传 ${name} 失败: ${String(error)}`); }
    }
    if (destinationPath === path) await refresh();
  }, [notify, path, refresh, tab.sessionId]);

  const uploadFiles = async (destinationPath = path) => {
    if (!isTauri()) return notify("桌面程序中可选择本地文件上传");
    const picked = await open({ multiple: true, directory: false });
    await uploadPaths(Array.isArray(picked) ? picked : picked ? [picked] : [], destinationPath);
  };

  const { dropActive, dropHandlers } = useFileDrop(
    dropTargetRef,
    active,
    uploadPaths,
    () => notify("请在 FunShell 桌面程序中拖入本地文件"),
  );

  const downloadFile = async (file: RemoteFileEntry) => {
    if (file.kind === "directory") return notify("目录请使用打包传输");
    if (!isTauri()) return notify(`演示模式：下载 ${file.name}`);
    const localPath = await save({ defaultPath: file.name });
    if (localPath) await api.downloadRemoteFile(tab.sessionId, file.path, localPath);
  };

  const openCreateDialog = (kind: "file" | "directory", parentPath = path) => setCreateDialog({ kind, name: "", parentPath });

  const createEntry = async () => {
    if (!createDialog) return;
    const name = createDialog.name.trim();
    if (!name || name.includes("/") || name === "." || name === "..") return notify("名称无效");
    if (createDialog.parentPath === path && visibleFiles.some((file) => file.name === name)) return notify("当前目录已存在同名项目");
    try {
      const parentPath = createDialog.parentPath;
      const remotePath = joinRemote(parentPath, name);
      if (createDialog.kind === "file") await api.createRemoteFile(tab.sessionId, remotePath);
      else await api.createRemoteDirectory(tab.sessionId, remotePath);
      setCreateDialog(null);
      if (parentPath === path) await refresh();
      else navigateToPath(parentPath);
    } catch (error) { notify(String(error)); }
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

  const savePermissions = async (mode: number, owner: string, group: string) => {
    if (!permissionFile) return;
    setSavingPermissions(true);
    try {
      const currentOwner = permissionFile.user ?? (permissionFile.userId != null ? String(permissionFile.userId) : "");
      const currentGroup = permissionFile.group ?? (permissionFile.groupId != null ? String(permissionFile.groupId) : "");
      if (owner !== currentOwner || group !== currentGroup) {
        await api.chownRemotePath(tab.sessionId, permissionFile.path, owner, group);
      }
      await api.chmodRemotePath(tab.sessionId, permissionFile.path, mode);
      setPermissionFile(null);
      await refresh();
      notify("文件权限和所有者已更新");
    } catch (error) {
      notify(String(error));
    } finally {
      setSavingPermissions(false);
    }
  };

  return (
    <div className="file-manager">
      <RemoteDirectoryTree
        sessionId={tab.sessionId}
        currentPath={path}
        loadedPath={filesSessionId === tab.sessionId ? filesPath : null}
        loadedEntries={visibleFiles}
        onNavigate={navigateToPath}
        onOpenContextMenu={(targetPath, x, y) => setContext({ x, y, file: null, targetPath })}
        onError={notify}
      />
      <div className="file-browser">
        <div className="file-toolbar">
          <div className="file-path-input"><Folder size={14} /><input aria-label="当前目录" title="输入远程目录后按 Enter" value={pathInput} onChange={(event) => setPathInput(event.target.value)} onBlur={() => setPathInput(path)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void openTypedPath(); } else if (event.key === "Escape") setPathInput(path); }} /><button type="button" aria-label="打开路径" title="打开路径" onMouseDown={(event) => event.preventDefault()} onClick={() => void openTypedPath()}><ArrowRight size={14} /></button></div>
          <IconButton label="上级目录" onClick={() => navigateToPath(parentRemote(path))}><Folder size={16} /></IconButton>
          <IconButton label="刷新" onClick={() => void refresh()}><RefreshCw size={16} className={loading ? "spin" : ""} /></IconButton>
          <IconButton label="新建文件夹" onClick={() => openCreateDialog("directory")}><FolderPlus size={16} /></IconButton>
          <IconButton label="上传" onClick={() => void uploadFiles()}><Upload size={16} /></IconButton>
          <IconButton label="下载" disabled={!selected} onClick={() => selected && void downloadFile(selected)}><Download size={16} /></IconButton>
          <IconButton label="删除" disabled={!selected} onClick={() => selected && void remove(selected)}><Trash2 size={16} /></IconButton>
        </div>
        <div ref={(node) => { dropTargetRef.current = node; virtualFiles.containerRef.current = node; }} className={`file-table-wrap ${dropActive ? "drop-active" : ""}`} {...dropHandlers} onContextMenu={(event) => { event.preventDefault(); setSelected(null); setContext({ x: event.clientX, y: event.clientY, file: null, targetPath: path }); }}>
          <table className="data-table file-table virtualized-table">
            <thead><tr><th>文件名</th><th>大小</th><th>类型</th><th>修改时间</th><th>权限</th><th>用户/用户组</th></tr></thead>
            <tbody>
              <VirtualTableSpacer height={virtualFiles.beforeHeight} columns={6} />
              {virtualFiles.rows.map(({ item: file, index }) => (
                <tr key={file.path} className={`${selected?.path === file.path ? "selected " : ""}${index % 2 ? "virtual-even" : ""}`} onClick={() => setSelected(file)} onDoubleClick={() => void openEntry(file)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setSelected(file); setContext({ x: event.clientX, y: event.clientY, file, targetPath: path }); }}>
                  <td>
                    <span className={`file-icon ${file.kind}`}>{file.kind === "directory" ? <Folder size={16} /> : file.kind === "symlink" ? <Link2 size={16} /> : <File size={16} />}</span>
                    <span className="file-entry-label">
                      <span title={file.name}>{file.name}</span>
                      {file.kind === "symlink" && file.linkTarget && <small title={`链接来源：${file.linkTarget}`}>链接来源：{file.linkTarget}</small>}
                    </span>
                  </td>
                  <td>{file.kind === "directory" ? "" : formatBytes(file.size)}</td><td>{file.kind === "directory" ? "文件夹" : file.kind === "symlink" ? "链接" : "文件"}</td>
                  <td>{file.modified ? new Date(file.modified * 1000).toLocaleString() : "-"}</td><td>{formatMode(file.permissions, file.kind)}</td><td>{formatIdentity(file.user, file.userId)}/{formatIdentity(file.group, file.groupId)}</td>
                </tr>
              ))}
              <VirtualTableSpacer height={virtualFiles.afterHeight} columns={6} />
            </tbody>
          </table>
          {dropActive && <div className="file-drop-overlay"><Upload size={22} /><strong>上传到 {path}</strong></div>}
        </div>
      </div>
      {context && (
        <ContextMenu x={context.x} y={context.y} onClose={() => setContext(null)}>
          {context.file ? <>
            <button type="button" onClick={() => void refresh()}>刷新</button>
            <button type="button" onClick={() => void openEntry(context.file!)}>打开</button>
            {context.file.kind === "file" && <button type="button" onClick={() => void editEntry(context.file!)}>文本编辑</button>}
            <button type="button" onClick={() => void navigator.clipboard.writeText(context.file!.path)}>复制路径</button>
            <button type="button" onClick={() => void downloadFile(context.file!)}>下载</button>
            <button type="button" onClick={() => void uploadFiles()}>上传</button>
            <hr />
            <button type="button" onClick={() => void rename(context.file!)}>重命名</button>
            <button type="button" className="danger" onClick={() => void remove(context.file!)}>删除</button>
            <button type="button" onClick={() => setPermissionFile(context.file!)}>文件权限...</button>
          </> : <>
            <button type="button" onClick={() => { if (context.targetPath === path) void refresh(); else navigateToPath(context.targetPath); }}>刷新</button>
            <button type="button" onClick={() => openCreateDialog("file", context.targetPath)}>新建文件</button>
            <button type="button" onClick={() => openCreateDialog("directory", context.targetPath)}>新建文件夹</button>
            <button type="button" onClick={() => void uploadFiles(context.targetPath)}>上传文件</button>
          </>}
        </ContextMenu>
      )}
      <Modal open={createDialog != null} title={createDialog?.kind === "file" ? "新建文件" : "新建文件夹"} width={430} onClose={() => setCreateDialog(null)} footer={<><button type="button" onClick={() => setCreateDialog(null)}>取消</button><button className="primary-button" type="button" disabled={!createDialog?.name.trim()} onClick={() => void createEntry()}>创建</button></>}>
        <div className="form-grid"><label className="wide">目标目录<input value={createDialog?.parentPath ?? ""} readOnly /></label><label className="wide">{createDialog?.kind === "file" ? "文件名称" : "文件夹名称"}<input autoFocus value={createDialog?.name ?? ""} onChange={(event) => setCreateDialog((current) => current ? { ...current, name: event.target.value } : null)} onKeyDown={(event) => { if (event.key === "Enter") void createEntry(); }} /></label></div>
      </Modal>
      <Modal
        open={editorOpen && (editorDocuments.length > 0 || editorLoadingPaths.length > 0)}
        title={editorDocuments.length > 1 ? `远程编辑 (${editorDocuments.length} 个文件)` : editor ? `远程编辑 - ${editor.path}` : `正在打开 - ${editorLoadingPaths[0] ?? ""}`}
        width={editorDocuments.length > 1 ? 1120 : 900}
        onClose={closeEditorWorkspace}
        footer={<><button type="button" onClick={closeEditorWorkspace}>关闭</button><button className="primary-button" type="button" disabled={!editorDocuments.some((document) => document.dirty)} onClick={() => void saveAllEditors()}>全部保存</button></>}
      >
        <div className="editor-workspace">
          <header className="editor-toolbar">
            <div className="editor-document-tabs">
              {editorDocuments.map((document) => (
                <div key={document.path} className={`editor-document-tab ${document.path === editor?.path ? "active" : ""}`}>
                  <button type="button" onClick={() => setActiveEditorPath(document.path)} title={document.path}>{remoteFileName(document.path)}{document.dirty ? " *" : ""}</button>
                  <IconButton label={`关闭 ${remoteFileName(document.path)}`} onClick={() => closeEditorDocument(document.path)}><X size={13} /></IconButton>
                </div>
              ))}
              {editorLoadingPaths.map((targetPath) => (
                <div key={targetPath} className="editor-document-tab loading">
                  <span><RefreshCw size={12} className="spin" />{remoteFileName(targetPath)}</span>
                  <IconButton label={`取消读取 ${remoteFileName(targetPath)}`} onClick={() => cancelEditorLoading(targetPath)}><X size={13} /></IconButton>
                </div>
              ))}
            </div>
            <button type="button" className="editor-open-button" onClick={() => setEditorPickerOpen(true)}><Plus size={14} />打开文件</button>
          </header>
          <div className="editor-document-grid">
            {editorDocuments.map((document) => (
              <article key={document.path} className={`editor-document ${document.path === editor?.path ? "active" : ""}`}>
                <header className="editor-document-header">
                  <div><strong>{remoteFileName(document.path)}{document.dirty ? " *" : ""}</strong><span title={document.path}>{document.path}</span></div>
                  <div className="editor-document-actions">
                    <IconButton label={`保存 ${remoteFileName(document.path)}`} disabled={!document.dirty} onClick={() => void saveEditorDocument(document.path)}><Save size={14} /></IconButton>
                    <IconButton label={`关闭 ${remoteFileName(document.path)}`} onClick={() => closeEditorDocument(document.path)}><X size={14} /></IconButton>
                  </div>
                </header>
                <textarea className="remote-editor" value={document.content} onFocus={() => setActiveEditorPath(document.path)} onChange={(event) => updateEditorContent(document.path, event.target.value)} spellCheck={false} />
              </article>
            ))}
            {editorLoadingPaths.map((targetPath) => (
              <article key={`loading-${targetPath}`} className="editor-document loading">
                <div className="editor-loading" role="status"><RefreshCw size={20} className="spin" /><span>正在读取 {remoteFileName(targetPath)}...</span></div>
              </article>
            ))}
          </div>
        </div>
      </Modal>
      <Modal open={editorPickerOpen} title="打开远程文件" width={520} onClose={() => setEditorPickerOpen(false)} footer={<button type="button" onClick={() => setEditorPickerOpen(false)}>取消</button>}>
        <div className="editor-file-picker">
          <span className="editor-file-picker-path">当前目录：{path}</span>
          {visibleFiles.filter((file) => file.kind === "file").map((file) => (
            <button key={file.path} type="button" onClick={() => { setEditorPickerOpen(false); void editEntry(file); }}><File size={14} /><span><strong>{file.name}</strong><small>{file.path}</small></span></button>
          ))}
          {!visibleFiles.some((file) => file.kind === "file") && <div className="empty-state">当前目录没有可编辑文件</div>}
        </div>
      </Modal>
      <PermissionDialog
        file={permissionFile}
        saving={savingPermissions}
        identities={identitiesSessionId === tab.sessionId ? remoteIdentities : null}
        identitiesLoading={identitiesLoading}
        identitiesError={identitiesError}
        onReloadIdentities={() => void loadRemoteIdentities(true)}
        onClose={() => setPermissionFile(null)}
        onSave={(mode, owner, group) => void savePermissions(mode, owner, group)}
      />
    </div>
  );
}
