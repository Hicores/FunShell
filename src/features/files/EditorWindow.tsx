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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api.readRemoteText(sessionId, path)
      .then((value) => {
        if (!active) return;
        setContent(value.content);
        setError(null);
      })
      .catch((reason) => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, sessionId]);

  const close = async () => {
    if (dirty && !window.confirm("文件有未保存修改，确认关闭？")) return;
    if (isTauri()) await getCurrentWindow().close();
    else window.close();
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.writeRemoteText(sessionId, path, content);
      setDirty(false);
      setError(null);
    } catch (reason) {
      setError(String(reason));
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
          <button type="button" className="editor-window-save" disabled={loading || saving || !dirty} onClick={() => void save}><Save size={15} />{saving ? "保存中..." : "保存"}</button>
          <button type="button" className="editor-window-close" onClick={() => void close}><X size={16} />关闭</button>
        </div>
      </header>
      {loading ? <div className="editor-window-loading" role="status"><LoaderCircle size={22} className="spin" /><span>正在读取远程文本...</span></div> : error ? <div className="editor-window-error" role="alert"><strong>文件读取失败</strong><span>{error}</span><button type="button" onClick={() => window.location.reload()}>重试</button></div> : <textarea className="editor-window-textarea" value={content} onChange={(event) => { setContent(event.target.value); setDirty(true); }} spellCheck={false} autoFocus />}
    </main>
  );
}
