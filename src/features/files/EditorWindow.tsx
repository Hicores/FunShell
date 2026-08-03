import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileText, LoaderCircle, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, isTauri } from "../../lib/ipc";

interface EditorWindowProps {
  sessionId: string;
  path: string;
}

export function EditorWindow({ sessionId, path }: EditorWindowProps) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api.readRemoteText(sessionId, path)
      .then((value) => {
        if (!active) return;
        setContent(value.content);
        setLoadError(null);
      })
      .catch((reason) => { if (active) setLoadError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, sessionId]);

  const close = async () => {
    if (dirty && !window.confirm("文件有未保存修改，确认关闭？")) return;
    setCloseError(null);
    try {
      if (isTauri()) await getCurrentWindow().close();
      else window.close();
    } catch (reason) {
      setCloseError(String(reason));
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.writeRemoteText(sessionId, path, content);
      setDirty(false);
      setSaveError(null);
      setSaveMessage("已保存");
    } catch (reason) {
      setSaveMessage(null);
      setSaveError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  const title = path.split("/").at(-1) || path;
  return (
    <main className="editor-window-shell">
      <header className="editor-window-header">
        <div className="editor-window-heading"><FileText size={18} /><div><strong>{title}</strong><span title={path}>{path}</span></div></div>
        <div className="editor-window-actions">
          <button type="button" className="editor-window-save" title={dirty ? "保存远程文件" : "没有待保存的修改"} disabled={loading || saving || !dirty} onClick={() => void save()}><Save size={15} />{saving ? "保存中..." : "保存"}</button>
          <button type="button" className="editor-window-close" onClick={() => void close()}><X size={16} />关闭</button>
        </div>
      </header>
      {closeError && <div className="editor-window-close-error" role="alert">窗口关闭失败：{closeError}</div>}
      {loading ? <div className="editor-window-loading" role="status"><LoaderCircle size={22} className="spin" /><span>正在读取远程文本...</span></div> : loadError ? <div className="editor-window-error" role="alert"><strong>文件读取失败</strong><span>{loadError}</span><button type="button" onClick={() => window.location.reload()}>重试</button></div> : <div className="editor-window-editor"><textarea className="editor-window-textarea" value={content} onChange={(event) => { setContent(event.target.value); setDirty(true); setSaveMessage(null); setSaveError(null); }} spellCheck={false} autoFocus />{saveError && <div className="editor-window-save-error" role="alert">保存失败：{saveError}</div>}{saveMessage && <div className="editor-window-save-message" role="status">{saveMessage}</div>}</div>}
    </main>
  );
}
