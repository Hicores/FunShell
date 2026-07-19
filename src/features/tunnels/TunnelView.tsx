import { CircleStop, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import type { TunnelKind, TunnelProfile, TunnelRuntime, WorkspaceTab } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { Modal } from "../../components/common/Modal";
import { IconButton } from "../../components/common/IconButton";

const blank = (connectionId: string): TunnelProfile => ({ id: "", connectionId, name: "", kind: "local", bindHost: "127.0.0.1", bindPort: 0, targetHost: "127.0.0.1", targetPort: 80, autoStart: false });

export function TunnelView({ tab, active = true }: { tab: WorkspaceTab; active?: boolean }) {
  const notify = useAppStore((state) => state.notify);
  const [profiles, setProfiles] = useState<TunnelProfile[]>([]);
  const [statuses, setStatuses] = useState<TunnelRuntime[]>([]);
  const [editor, setEditor] = useState<TunnelProfile | null>(null);
  const refreshingRef = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try { const [nextProfiles, nextStatuses] = await Promise.all([api.tunnelProfiles(), api.tunnelStatuses()]); setProfiles(nextProfiles); setStatuses(nextStatuses); }
    catch (error) { notify(String(error)); }
    finally { refreshingRef.current = false; }
  }, [notify]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      await refresh();
      if (!disposed) timer = window.setTimeout(() => void poll(), 1800);
    };
    void poll();
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [active, refresh]);
  const runtime = (id: string) => statuses.find((item) => item.profileId === id);
  const saveProfile = async () => { if (!editor) return; try { await api.saveTunnel(editor); setEditor(null); await refresh(); } catch (error) { notify(String(error)); } };
  const start = async (profile: TunnelProfile) => { try { await api.startTunnel(profile.id, tab.sessionId); await refresh(); } catch (error) { notify(String(error)); } };
  const stop = async (profile: TunnelProfile) => { try { await api.stopTunnel(profile.id); await refresh(); } catch (error) { notify(String(error)); } };
  return (
    <section className="detail-view tunnel-view">
      <header className="view-toolbar"><strong>SSH 隧道</strong><span>本地、远端和动态 SOCKS5 转发</span><button type="button" onClick={() => setEditor(blank(tab.connectionId))}><Plus size={15} />新建隧道</button><IconButton label="刷新" onClick={() => void refresh()}><RefreshCw size={16} /></IconButton></header>
      <table className="data-table tunnel-table"><thead><tr><th>名称</th><th>类型</th><th>监听</th><th>目标</th><th>状态</th><th>连接数</th><th>上传/下载</th><th>操作</th></tr></thead><tbody>{profiles.filter((profile) => profile.connectionId === tab.connectionId).map((profile) => { const state = runtime(profile.id); return <tr key={profile.id}><td>{profile.name}</td><td>{profile.kind === "local" ? "本地转发" : profile.kind === "remote" ? "远端转发" : "动态 SOCKS5"}</td><td>{profile.bindHost}:{state?.boundPort ?? profile.bindPort}</td><td>{profile.kind === "dynamic" ? "按请求动态连接" : `${profile.targetHost}:${profile.targetPort}`}</td><td><span className={`runtime-state ${state?.state ?? "stopped"}`}>{state ? "运行中" : "已停止"}</span></td><td>{state?.connections ?? 0}</td><td>{formatBytes(state?.uploadedBytes ?? 0)} / {formatBytes(state?.downloadedBytes ?? 0)}</td><td><button type="button" title={state ? "停止" : "启动"} onClick={() => void (state ? stop(profile) : start(profile))}>{state ? <CircleStop size={15} /> : <Play size={15} />}</button><button type="button" title="编辑" onClick={() => setEditor(profile)}>编辑</button><button type="button" title="删除" onClick={async () => { if (!window.confirm(`删除隧道 ${profile.name}？`)) return; await api.deleteTunnel(profile.id); await refresh(); }}><Trash2 size={15} /></button></td></tr>; })}</tbody></table>
      {!profiles.some((profile) => profile.connectionId === tab.connectionId) && <div className="empty-state large">当前连接没有隧道配置</div>}
      <Modal open={editor != null} title={editor?.id ? "编辑隧道" : "新建隧道"} width={620} onClose={() => setEditor(null)} footer={<><button type="button" onClick={() => setEditor(null)}>取消</button><button className="primary-button" type="button" onClick={() => void saveProfile()}>保存</button></>}>
        {editor && <div className="form-grid tunnel-form"><label className="wide">名称<input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label><label>类型<select value={editor.kind} onChange={(event) => setEditor({ ...editor, kind: event.target.value as TunnelKind })}><option value="local">本地转发</option><option value="remote">远端转发</option><option value="dynamic">动态 SOCKS5</option></select></label><span /><label>监听地址<input value={editor.bindHost} onChange={(event) => setEditor({ ...editor, bindHost: event.target.value })} /></label><label>监听端口<input type="number" min={0} max={65535} value={editor.bindPort} onChange={(event) => setEditor({ ...editor, bindPort: Number(event.target.value) })} /></label>{editor.kind !== "dynamic" && <><label>目标主机<input value={editor.targetHost ?? ""} onChange={(event) => setEditor({ ...editor, targetHost: event.target.value })} /></label><label>目标端口<input type="number" min={1} max={65535} value={editor.targetPort ?? 0} onChange={(event) => setEditor({ ...editor, targetPort: Number(event.target.value) })} /></label></>}<label className="checkbox-line wide"><input type="checkbox" checked={editor.autoStart} onChange={(event) => setEditor({ ...editor, autoStart: event.target.checked })} />连接后自动启动</label></div>}
      </Modal>
    </section>
  );
}
