import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../../components/common/Modal";
import { api } from "../../lib/ipc";
import type { WorkspaceTab } from "../../types";

interface FolderWarning {
  localPath: string;
  remotePath: string;
  fileCount: number;
  resolve: (confirmed: boolean) => void;
}

export function usePathUpload(tab: WorkspaceTab, path: string, refresh: () => Promise<void>, notify: (message: string) => void) {
  const [warning, setWarning] = useState<FolderWarning | null>(null);
  const pending = useRef<FolderWarning | null>(null);
  const busy = useRef(false);
  const session = useRef(tab);
  session.current = tab;
  const currentView = useRef({ path, refresh });
  currentView.current = { path, refresh };
  const mounted = useRef(true);

  const dismissWarning = useCallback((confirmed: boolean) => {
    pending.current?.resolve(confirmed);
    pending.current = null;
    setWarning(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, []);

  useEffect(() => {
    dismissWarning(false);
  }, [tab.sessionId, tab.state, dismissWarning]);

  const uploadPaths = useCallback(async (localPaths: string[], destinationPath = path) => {
    if (!localPaths.length) return;
    if (busy.current) return notify("正在处理上传，请稍后再拖入文件或文件夹");
    const sessionId = tab.sessionId;
    const usable = () => mounted.current && session.current.sessionId === sessionId && session.current.state === "connected";
    if (!usable()) return notify("请先连接服务器再上传");
    busy.current = true;
    let changed = false;
    try {
      for (const localPath of localPaths) {
        if (!usable()) break;
        const name = localPath.replaceAll("\\", "/").replace(/\/+$/, "").split("/").at(-1);
        if (!name) { notify("无法确定上传对象的名称"); continue; }
        const remotePath = `${destinationPath.replace(/\/+$/, "")}/${name}`;
        try {
          const info = await api.inspectLocalUpload(localPath);
          if (!usable()) break;
          let confirmed = false;
          if (info.directory && info.fileCount > 64) {
            confirmed = await new Promise<boolean>((resolve) => {
              const value = { localPath, remotePath, fileCount: info.fileCount, resolve };
              pending.current = value;
              setWarning(value);
            });
            if (!confirmed || !usable()) continue;
          }
          changed = true;
          if (info.directory) {
            await api.uploadRemoteDirectory(sessionId, localPath, remotePath, confirmed);
            if (usable()) notify(`文件夹 ${name} 上传完成`);
          } else {
            await api.uploadRemoteFile(sessionId, localPath, remotePath);
          }
        } catch (error) {
          if (usable()) notify(`上传 ${name} 失败: ${String(error)}`);
        }
      }
      if (changed && usable() && destinationPath === currentView.current.path) await currentView.current.refresh();
    } finally {
      busy.current = false;
    }
  }, [notify, path, tab.sessionId]);

  const uploadWarning = (
    <Modal
      open={warning != null}
      title="文件夹上传提示"
      width={500}
      onClose={() => dismissWarning(false)}
      footer={<><button type="button" onClick={() => dismissWarning(false)}>取消</button><button type="button" className="primary-button" onClick={() => dismissWarning(true)}>继续上传</button></>}
    >
      <p>此文件夹及其子文件夹共包含 {warning?.fileCount} 个文件，超过 64 个。上传可能需要较长时间，是否继续？</p>
      <div className="form-grid">
        <label className="wide">本地文件夹<input value={warning?.localPath ?? ""} readOnly /></label>
        <label className="wide">上传路径<input value={warning?.remotePath ?? ""} readOnly /></label>
      </div>
    </Modal>
  );

  return { uploadPaths, uploadWarning };
}
