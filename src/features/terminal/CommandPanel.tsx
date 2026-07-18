import { History, Play, Plus, Search, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import type { CommandHistoryEntry, CommandPreset, WorkspaceTab } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { Modal } from "../../components/common/Modal";

export function resolvePresetVariables(command: string): string | null {
  let resolved = command;
  const variables = [...new Set([...command.matchAll(/\$\{([^}]+)\}/g)].map((match) => match[1].trim()).filter(Boolean))];
  for (const variable of variables) {
    const value = window.prompt(`请输入变量 ${variable}`);
    if (value == null) return null;
    resolved = resolved.replaceAll(`\${${variable}}`, value);
  }
  return resolved;
}

export function CommandPanel({ tab }: { tab: WorkspaceTab }) {
  const notify = useAppStore((state) => state.notify);
  const [mode, setMode] = useState<"history" | "presets">("history");
  const [history, setHistory] = useState<CommandHistoryEntry[]>([]);
  const [presets, setPresets] = useState<CommandPreset[]>([]);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ name: string; command: string; tags: string; scope: "global" | "folder" | "connection" }>({ name: "", command: "", tags: "", scope: "connection" });
  const [editorOpen, setEditorOpen] = useState(false);
  const connections = useAppStore((state) => state.connections);
  const connection = connections.find((item) => item.id === tab.connectionId);

  const refresh = useCallback(async () => {
    try {
      const [nextHistory, nextPresets] = await Promise.all([api.history(tab.connectionId, search), api.presets()]);
      setHistory(nextHistory); setPresets(nextPresets);
    } catch (error) { notify(String(error)); }
  }, [notify, search, tab.connectionId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (command: string) => { const resolved = resolvePresetVariables(command); if (resolved == null) return; await api.terminalCommand(tab.sessionId, resolved); await refresh(); };
  const insert = (command: string) => {
    const resolved = resolvePresetVariables(command);
    if (resolved == null) return;
    window.dispatchEvent(new CustomEvent("funshell-insert-command", { detail: { sessionId: tab.sessionId, command: resolved } }));
  };
  const createPreset = async () => {
    if (!editor.name.trim() || !editor.command.trim()) return notify("请填写预设名称和命令");
    const scopeId = editor.scope === "connection" ? tab.connectionId : editor.scope === "folder" ? connection?.folderId ?? null : null;
    await api.savePreset({ id: "", scope: editor.scope, scopeId, name: editor.name.trim(), command: editor.command, tags: editor.tags.split(",").map((tag) => tag.trim()).filter(Boolean), sortOrder: presets.length });
    setEditorOpen(false); setEditor({ name: "", command: "", tags: "", scope: "connection" }); await refresh();
  };

  return (
    <div className="command-panel">
      <aside>
        <button className={mode === "history" ? "active" : ""} type="button" onClick={() => setMode("history")}><History size={15} />历史记录</button>
        <button className={mode === "presets" ? "active" : ""} type="button" onClick={() => setMode("presets")}><Star size={15} />命令预设</button>
      </aside>
      <section>
        <header><label><Search size={14} /><input placeholder="搜索命令" value={search} onChange={(event) => setSearch(event.target.value)} /></label>{mode === "presets" && <button type="button" onClick={() => setEditorOpen(true)}><Plus size={14} />新建预设</button>}{mode === "history" && <button type="button" onClick={async () => { await api.clearHistory(tab.connectionId); await refresh(); }}><Trash2 size={14} />清空</button>}</header>
        <div className="command-list">
          {mode === "history" ? history.map((entry) => (
            <div key={entry.id}><button type="button" title="收藏" onClick={async () => { await api.favoriteHistory(entry.id, !entry.favorite); await refresh(); }}><Star size={14} fill={entry.favorite ? "currentColor" : "none"} /></button><code>{entry.command}</code><span>{new Date(entry.executedAt).toLocaleString()}</span><button type="button" onClick={() => void run(entry.command)}><Play size={14} />执行</button></div>
          )) : presets.filter((preset) => preset.name.includes(search) || preset.command.includes(search)).map((preset) => (
            <div key={preset.id}><Star size={14} /><strong>{preset.name}</strong><code>{preset.command}</code><span className="command-actions"><button type="button" onClick={() => insert(preset.command)}>插入</button><button type="button" onClick={() => void run(preset.command)}><Play size={14} />执行</button></span></div>
          ))}
          {mode === "history" && !history.length && <div className="empty-state">尚无命令历史</div>}
        </div>
      </section>
      <Modal open={editorOpen} title="新建命令预设" width={640} onClose={() => setEditorOpen(false)} footer={<><button type="button" onClick={() => setEditorOpen(false)}>取消</button><button className="primary-button" type="button" onClick={() => void createPreset()}>保存</button></>}>
        <div className="form-grid preset-editor"><label className="wide">名称<input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label><label>作用范围<select value={editor.scope} onChange={(event) => setEditor({ ...editor, scope: event.target.value as typeof editor.scope })}><option value="global">全局</option>{connection?.folderId && <option value="folder">当前目录</option>}<option value="connection">当前服务器</option></select></label><label>标签<input placeholder="systemd, deploy" value={editor.tags} onChange={(event) => setEditor({ ...editor, tags: event.target.value })} /></label><label className="wide">命令<textarea rows={8} value={editor.command} onChange={(event) => setEditor({ ...editor, command: event.target.value })} /></label></div>
      </Modal>
    </div>
  );
}
