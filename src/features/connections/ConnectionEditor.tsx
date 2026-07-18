import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Modal } from "../../components/common/Modal";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { AuthMethod, SaveConnectionInput } from "../../types";

const createBlank = (folderId: string | null = null): SaveConnectionInput => ({ name: "", host: "", port: 22, username: "root", authMethod: "password", password: "", keyId: null, routeId: null, folderId, startupCommand: null, keepaliveSeconds: 30, connectTimeoutSeconds: 10, compression: false, autoReconnect: true });

export function ConnectionEditor() {
  const open = useAppStore((state) => state.connectionEditorOpen);
  const editing = useAppStore((state) => state.editingConnection);
  const newConnectionFolderId = useAppStore((state) => state.newConnectionFolderId);
  const close = useAppStore((state) => state.closeConnectionEditor);
  const folders = useAppStore((state) => state.folders);
  const keys = useAppStore((state) => state.keys);
  const routes = useAppStore((state) => state.routes);
  const refresh = useAppStore((state) => state.refreshConnections);
  const notify = useAppStore((state) => state.notify);
  const openKeyManager = useAppStore((state) => state.openKeyManager);
  const [section, setSection] = useState<"general" | "terminal" | "route">("general");
  const [form, setForm] = useState<SaveConnectionInput>(createBlank());

  useEffect(() => {
    if (!open) return;
    setSection("general");
    setForm(editing ? {
      id: editing.id, folderId: editing.folderId, name: editing.name, host: editing.host, port: editing.port,
      username: editing.username, authMethod: editing.authMethod, password: "", keyId: editing.keyId,
      routeId: editing.routeId, startupCommand: editing.startupCommand, keepaliveSeconds: editing.keepaliveSeconds,
      connectTimeoutSeconds: editing.connectTimeoutSeconds, compression: editing.compression, autoReconnect: editing.autoReconnect,
    } : createBlank(newConnectionFolderId));
  }, [editing, newConnectionFolderId, open]);

  const update = <K extends keyof SaveConnectionInput>(key: K, value: SaveConnectionInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    try { await api.saveConnection(form); await refresh(); close(); notify("连接信息已保存"); }
    catch (error) { notify(String(error)); }
  };

  return (
    <Modal open={open} title={editing ? "编辑连接" : "新建连接"} width={840} onClose={close} footer={<><button type="button" onClick={close}>取消</button><button className="primary-button" type="button" onClick={() => void save()}>确定</button></>}>
      <div className="connection-editor">
        <aside><strong>SSH 连接</strong><button className={section === "general" ? "active" : ""} type="button" onClick={() => setSection("general")}>常规</button><button className={section === "terminal" ? "active" : ""} type="button" onClick={() => setSection("terminal")}>终端</button><button className={section === "route" ? "active" : ""} type="button" onClick={() => setSection("route")}>代理与加速</button></aside>
        <section>
          {section === "general" && (
            <>
              <fieldset>
                <legend>常规</legend>
                <div className="form-grid">
                  <label className="wide">名称<input autoFocus value={form.name} onChange={(event) => update("name", event.target.value)} /></label>
                  <label className="wide">目录<select value={form.folderId ?? ""} onChange={(event) => update("folderId", event.target.value || null)}><option value="">根目录</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
                  <label className="host-field">主机<input value={form.host} onChange={(event) => update("host", event.target.value)} /></label>
                  <label>端口<input type="number" min={1} max={65535} value={form.port} onChange={(event) => update("port", Number(event.target.value))} /></label>
                </div>
              </fieldset>
              <fieldset>
                <legend>认证</legend>
                <div className="form-grid">
                  <label>方法<select value={form.authMethod} onChange={(event) => update("authMethod", event.target.value as AuthMethod)}><option value="password">密码</option><option value="public_key">公钥</option></select></label><span />
                  <label>用户名<input value={form.username} onChange={(event) => update("username", event.target.value)} /></label><span />
                  {form.authMethod === "password" ? (
                    <label className="wide">密码<input type="password" placeholder={editing ? "留空则保持原密码" : ""} value={form.password ?? ""} onChange={(event) => update("password", event.target.value)} /></label>
                  ) : (
                    <div className="wide key-picker-field">
                      <label>私钥<select value={form.keyId ?? ""} onChange={(event) => update("keyId", event.target.value || null)}><option value="">选择私钥</option>{keys.map((key) => <option key={key.id} value={key.id}>{key.name} ({key.algorithm})</option>)}</select></label>
                      <button type="button" onClick={() => openKeyManager(true)}><KeyRound size={14} />密钥管理</button>
                    </div>
                  )}
                </div>
              </fieldset>
            </>
          )}
          {section === "terminal" && <fieldset><legend>终端与会话</legend><div className="form-grid"><label className="wide">连接后执行<textarea value={form.startupCommand ?? ""} onChange={(event) => update("startupCommand", event.target.value || null)} /></label><label>KeepAlive（秒）<input type="number" min={5} value={form.keepaliveSeconds} onChange={(event) => update("keepaliveSeconds", Number(event.target.value))} /></label><label>连接超时（秒）<input type="number" min={1} value={form.connectTimeoutSeconds} onChange={(event) => update("connectTimeoutSeconds", Number(event.target.value))} /></label><label className="checkbox-line"><input type="checkbox" checked={form.autoReconnect} onChange={(event) => update("autoReconnect", event.target.checked)} />断线自动重连</label><label className="checkbox-line"><input type="checkbox" checked={form.compression} onChange={(event) => update("compression", event.target.checked)} />启用 SSH 压缩</label></div></fieldset>}
          {section === "route" && <fieldset><legend>连接路线</legend><div className="form-grid"><label className="wide">路由配置<select value={form.routeId ?? ""} onChange={(event) => update("routeId", event.target.value || null)}><option value="">直连</option>{routes.map((route) => <option key={route.id} value={route.id}>{route.name}{route.autoSelect ? "（自动择优）" : ""}</option>)}</select></label><p className="field-note wide">自动择优会对直连、HTTP/SOCKS5 代理和 SSH 跳板执行三次连接探测，选择中位延迟最低的路线。</p></div></fieldset>}
        </section>
      </div>
    </Modal>
  );
}
