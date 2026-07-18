import { History, Play, Plus, Search, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import type { CommandHistoryEntry, CommandPreset, WorkspaceTab } from "../../types";
import { useAppStore } from "../../stores/appStore";

export function CommandPanel({ tab }: { tab: WorkspaceTab }) {
  const notify = useAppStore((state) => state.notify);
  const [mode, setMode] = useState<"history" | "presets">("history");
  const [history, setHistory] = useState<CommandHistoryEntry[]>([]);
  const [presets, setPresets] = useState<CommandPreset[]>([]);
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextHistory, nextPresets] = await Promise.all([api.history(tab.connectionId, search), api.presets()]);
      setHistory(nextHistory); setPresets(nextPresets);
    } catch (error) { notify(String(error)); }
  }, [notify, search, tab.connectionId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (command: string) => { await api.terminalCommand(tab.sessionId, command); await refresh(); };
  const createPreset = async () => {
    const name = window.prompt("预设名称");
    if (!name) return;
    const command = window.prompt("命令内容");
    if (!command) return;
    await api.savePreset({ id: "", scope: "connection", scopeId: tab.connectionId, name, command, tags: [], sortOrder: presets.length });
    await refresh();
  };

  return (
    <div className="command-panel">
      <aside>
        <button className={mode === "history" ? "active" : ""} type="button" onClick={() => setMode("history")}><History size={15} />历史记录</button>
        <button className={mode === "presets" ? "active" : ""} type="button" onClick={() => setMode("presets")}><Star size={15} />命令预设</button>
      </aside>
      <section>
        <header><label><Search size={14} /><input placeholder="搜索命令" value={search} onChange={(event) => setSearch(event.target.value)} /></label>{mode === "presets" && <button type="button" onClick={() => void createPreset()}><Plus size={14} />新建预设</button>}{mode === "history" && <button type="button" onClick={async () => { await api.clearHistory(tab.connectionId); await refresh(); }}><Trash2 size={14} />清空</button>}</header>
        <div className="command-list">
          {mode === "history" ? history.map((entry) => (
            <div key={entry.id}><button type="button" title="收藏" onClick={async () => { await api.favoriteHistory(entry.id, !entry.favorite); await refresh(); }}><Star size={14} fill={entry.favorite ? "currentColor" : "none"} /></button><code>{entry.command}</code><span>{new Date(entry.executedAt).toLocaleString()}</span><button type="button" onClick={() => void run(entry.command)}><Play size={14} />执行</button></div>
          )) : presets.filter((preset) => preset.name.includes(search) || preset.command.includes(search)).map((preset) => (
            <div key={preset.id}><Star size={14} /><strong>{preset.name}</strong><code>{preset.command}</code><button type="button" onClick={() => void run(preset.command)}><Play size={14} />执行</button></div>
          ))}
          {mode === "history" && !history.length && <div className="empty-state">尚无命令历史</div>}
        </div>
      </section>
    </div>
  );
}
