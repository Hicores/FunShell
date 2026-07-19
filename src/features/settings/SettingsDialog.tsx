import { Lock, Network, Plus, Route, Settings, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "../../components/common/Modal";
import { VaultPasswordDialog } from "../security/VaultPasswordDialog";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { AppSettings, ProxyProfile, RouteCandidate, RouteKind, RouteProfile, VaultStatus } from "../../types";

export function SettingsDialog() {
  const open = useAppStore((state) => state.settingsOpen);
  const setOpen = useAppStore((state) => state.openSettings);
  const connections = useAppStore((state) => state.connections);
  const proxies = useAppStore((state) => state.proxies);
  const routes = useAppStore((state) => state.routes);
  const notify = useAppStore((state) => state.notify);
  const [section, setSection] = useState<"general" | "vault" | "proxies" | "routes">("general");
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [proxyEditor, setProxyEditor] = useState<{ id?: string; name: string; kind: "http_connect" | "socks5"; host: string; port: number; username: string; password: string } | null>(null);
  const [routeEditor, setRouteEditor] = useState<RouteProfile | null>(null);
  const [vaultPasswordAction, setVaultPasswordAction] = useState<"create" | "enable" | "unlock" | null>(null);
  const [vaultPasswordBusy, setVaultPasswordBusy] = useState(false);
  const [vaultPasswordError, setVaultPasswordError] = useState<string | null>(null);
  const [confirmDpapi, setConfirmDpapi] = useState(false);

  const reloadNetwork = async () => {
    const [nextProxies, nextRoutes] = await Promise.all([api.listProxies(), api.listRoutes()]);
    useAppStore.setState({ proxies: nextProxies, routes: nextRoutes });
  };

  useEffect(() => {
    if (!open) return;
    void api.vaultStatus().then(setVault).catch((error) => notify(String(error)));
    void api.getSettings().then(setAppSettings).catch((error) => notify(String(error)));
    void reloadNetwork().catch((error) => notify(String(error)));
  }, [open]);

  const refreshVault = async () => setVault(await api.vaultStatus());
  const openVaultPassword = (action: "create" | "enable" | "unlock") => {
    setVaultPasswordError(null);
    setVaultPasswordAction(action);
  };
  const submitVaultPassword = async (password: string) => {
    if (!vaultPasswordAction) return;
    setVaultPasswordBusy(true);
    setVaultPasswordError(null);
    try {
      if (vaultPasswordAction === "unlock") {
        await api.unlockMasterVault(password);
      } else {
        await api.changeVaultMode("master_password", password);
      }
      await refreshVault();
      setVaultPasswordAction(null);
      notify(vaultPasswordAction === "unlock" ? "保险库已解锁" : "主密码保险库已启用");
    } catch {
      setVaultPasswordError(vaultPasswordAction === "create" ? "主密码保险库设置失败" : "主密码错误，请重新输入");
    } finally {
      setVaultPasswordBusy(false);
    }
  };
  const lockVault = async () => {
    try {
      await api.lockMasterVault();
      await refreshVault();
      notify("保险库已锁定");
    } catch (error) {
      notify(String(error));
    }
  };
  const switchToDpapi = async () => {
    setVaultPasswordBusy(true);
    try {
      await api.changeVaultMode("dpapi");
      await refreshVault();
      setConfirmDpapi(false);
      notify("已切换到 Windows DPAPI");
    } catch (error) {
      notify(String(error));
    } finally {
      setVaultPasswordBusy(false);
    }
  };

  const saveGeneral = async () => {
    if (!appSettings) return;
    try {
      const current = await api.getSettings();
      setAppSettings(await api.saveSettings({
        ...appSettings,
        terminalFontFamily: current.terminalFontFamily,
        terminalFontSize: current.terminalFontSize,
        terminalScrollbackLines: current.terminalScrollbackLines,
        quickConnectionCollapsedFolderIds: current.quickConnectionCollapsedFolderIds,
      }));
      notify("设置已保存");
    } catch (error) {
      notify(String(error));
    }
  };

  const saveProxy = async () => {
    if (!proxyEditor) return;
    try { await api.saveProxy({ ...proxyEditor, username: proxyEditor.username || null, password: proxyEditor.password || null }); setProxyEditor(null); await reloadNetwork(); }
    catch (error) { notify(String(error)); }
  };

  const addCandidate = (kind: RouteKind) => {
    if (!routeEditor) return;
    const candidate: RouteCandidate = { id: crypto.randomUUID(), kind, proxyId: kind === "proxy" ? proxies[0]?.id ?? null : null, jumpConnectionId: kind === "jump_host" ? connections[0]?.id ?? null : null, enabled: true };
    setRouteEditor({ ...routeEditor, candidates: [...routeEditor.candidates, candidate] });
  };

  const saveRoute = async () => {
    if (!routeEditor) return;
    try { await api.saveRoute(routeEditor); setRouteEditor(null); await reloadNetwork(); }
    catch (error) { notify(String(error)); }
  };

  return (
    <>
      <Modal open={open} title="设置" width={860} onClose={() => setOpen(false)} footer={<button type="button" onClick={() => setOpen(false)}>关闭</button>}>
        <div className="settings-layout">
          <aside><button className={section === "general" ? "active" : ""} type="button" onClick={() => setSection("general")}><Settings size={16} />常规</button><button className={section === "vault" ? "active" : ""} type="button" onClick={() => setSection("vault")}><Lock size={16} />凭据保险库</button><button className={section === "proxies" ? "active" : ""} type="button" onClick={() => setSection("proxies")}><Network size={16} />代理服务器</button><button className={section === "routes" ? "active" : ""} type="button" onClick={() => setSection("routes")}><Route size={16} />路线与加速</button></aside>
          <section>
            {section === "general" && <div className="settings-section"><h2>常规</h2><label>下载目录<input value="程序目录/downloads" readOnly /></label><label>界面语言<select defaultValue="zh-CN"><option value="zh-CN">简体中文</option></select></label>{appSettings && <><label className="checkbox-line"><input type="checkbox" checked={appSettings.confirmCloseActiveSessions} onChange={(event) => setAppSettings({ ...appSettings, confirmCloseActiveSessions: event.target.checked })} />关闭窗口前确认活动会话</label><label className="checkbox-line"><input type="checkbox" checked={appSettings.geoipEnabled} onChange={(event) => setAppSettings({ ...appSettings, geoipEnabled: event.target.checked })} />显示本地 IP 地理信息</label><button className="primary-button" type="button" onClick={() => void saveGeneral()}>保存常规设置</button></>}<p>IP 位置使用内置 IPv4/IPv6 数据库在本机查询，不会发送 IP 地址；运行数据、下载文件和日志均保存在 FunShell.exe 所在目录。</p></div>}
            {section === "vault" && vault && <div className="settings-section"><h2>凭据保险库</h2><div className="vault-status"><Lock size={25} /><div><strong>{vault.mode === "master_password" ? "主密码便携保险库" : "Windows DPAPI"}</strong><span>{vault.mode === "master_password" ? (vault.unlocked ? "已由当前 Windows 用户自动解锁，可随目录迁移" : "自动解锁数据无效，请输入主密码") : (vault.initialized ? "当前由 Windows DPAPI 保护，可重新启用主密码保险库" : "凭据由当前 Windows 用户的 DPAPI 保护")}</span></div></div><div className="vault-actions">{vault.mode === "dpapi" ? <button type="button" onClick={() => openVaultPassword(vault.initialized ? "enable" : "create")}>{vault.initialized ? "启用主密码保险库" : "设置主密码保险库"}</button> : <><button type="button" onClick={() => vault.unlocked ? void lockVault() : openVaultPassword("unlock")}>{vault.unlocked ? "立即锁定" : "解锁保险库"}</button><button type="button" disabled={!vault.unlocked} onClick={() => setConfirmDpapi(true)}>切换到 Windows DPAPI</button></>}</div></div>}
            {section === "proxies" && <div className="settings-section"><div className="settings-heading"><h2>代理服务器</h2><button type="button" onClick={() => setProxyEditor({ name: "", kind: "socks5", host: "127.0.0.1", port: 1080, username: "", password: "" })}><Plus size={14} />添加代理</button></div><table className="data-table"><thead><tr><th>名称</th><th>类型</th><th>地址</th><th>用户</th><th>操作</th></tr></thead><tbody>{proxies.map((proxy) => <tr key={proxy.id}><td>{proxy.name}</td><td>{proxy.kind === "socks5" ? "SOCKS5" : "HTTP CONNECT"}</td><td>{proxy.host}:{proxy.port}</td><td>{proxy.username ?? "-"}</td><td><button type="button" onClick={() => setProxyEditor({ id: proxy.id, name: proxy.name, kind: proxy.kind, host: proxy.host, port: proxy.port, username: proxy.username ?? "", password: "" })}>编辑</button></td></tr>)}</tbody></table></div>}
            {section === "routes" && <div className="settings-section"><div className="settings-heading"><h2>路线与自定义加速</h2><button type="button" onClick={() => setRouteEditor({ id: "", name: "", autoSelect: true, fixedCandidateId: null, candidates: [{ id: crypto.randomUUID(), kind: "direct", proxyId: null, jumpConnectionId: null, enabled: true }] })}><Plus size={14} />新建路线</button></div>{routes.map((route) => <button className="route-row" key={route.id} type="button" onClick={() => setRouteEditor(route)}><Route size={16} /><strong>{route.name}</strong><span>{route.candidates.length} 条候选路线</span><em>{route.autoSelect ? "自动择优" : "固定路线"}</em></button>)}</div>}
          </section>
        </div>
      </Modal>

      <VaultPasswordDialog
        open={vaultPasswordAction != null}
        title={vaultPasswordAction === "create" ? "设置主密码保险库" : vaultPasswordAction === "enable" ? "启用主密码保险库" : "解锁凭据保险库"}
        mode={vaultPasswordAction === "create" ? "create" : "unlock"}
        busy={vaultPasswordBusy}
        error={vaultPasswordError}
        onClose={() => { if (!vaultPasswordBusy) setVaultPasswordAction(null); }}
        onSubmit={(password) => void submitVaultPassword(password)}
      />

      <Modal open={confirmDpapi} title="切换凭据保护方式" width={470} onClose={() => { if (!vaultPasswordBusy) setConfirmDpapi(false); }} footer={<><button type="button" disabled={vaultPasswordBusy} onClick={() => setConfirmDpapi(false)}>取消</button><button className="primary-button" type="button" disabled={vaultPasswordBusy} onClick={() => void switchToDpapi()}>确认切换</button></>}>
        <p className="connection-delete-message">切换后，凭据将只由当前 Windows 用户的 DPAPI 保护。</p>
      </Modal>

      <Modal open={proxyEditor != null} title={proxyEditor?.id ? "编辑代理" : "添加代理"} width={560} onClose={() => setProxyEditor(null)} footer={<><button type="button" onClick={() => setProxyEditor(null)}>取消</button><button className="primary-button" type="button" onClick={() => void saveProxy()}>保存</button></>}>
        {proxyEditor && <div className="form-grid"><label className="wide">名称<input value={proxyEditor.name} onChange={(event) => setProxyEditor({ ...proxyEditor, name: event.target.value })} /></label><label>类型<select value={proxyEditor.kind} onChange={(event) => setProxyEditor({ ...proxyEditor, kind: event.target.value as ProxyProfile["kind"] })}><option value="socks5">SOCKS5</option><option value="http_connect">HTTP CONNECT</option></select></label><span /><label>主机<input value={proxyEditor.host} onChange={(event) => setProxyEditor({ ...proxyEditor, host: event.target.value })} /></label><label>端口<input type="number" value={proxyEditor.port} onChange={(event) => setProxyEditor({ ...proxyEditor, port: Number(event.target.value) })} /></label><label>用户名<input value={proxyEditor.username} onChange={(event) => setProxyEditor({ ...proxyEditor, username: event.target.value })} /></label><label>密码<input type="password" placeholder={proxyEditor.id ? "留空保持原密码" : ""} value={proxyEditor.password} onChange={(event) => setProxyEditor({ ...proxyEditor, password: event.target.value })} /></label></div>}
      </Modal>

      <Modal open={routeEditor != null} title="编辑连接路线" width={700} onClose={() => setRouteEditor(null)} footer={<><button type="button" onClick={() => setRouteEditor(null)}>取消</button><button className="primary-button" type="button" onClick={() => void saveRoute()}>保存</button></>}>
        {routeEditor && <div className="route-editor"><label>名称<input value={routeEditor.name} onChange={(event) => setRouteEditor({ ...routeEditor, name: event.target.value })} /></label><label className="checkbox-line"><input type="checkbox" checked={routeEditor.autoSelect} onChange={(event) => setRouteEditor({ ...routeEditor, autoSelect: event.target.checked })} />自动测量并选择中位延迟最低的路线</label><div className="candidate-toolbar"><button type="button" onClick={() => addCandidate("direct")}>+ 直连</button><button type="button" disabled={!proxies.length} onClick={() => addCandidate("proxy")}>+ 代理</button><button type="button" disabled={!connections.length} onClick={() => addCandidate("jump_host")}>+ SSH 跳板</button></div>{routeEditor.candidates.map((candidate) => <div className="candidate-row" key={candidate.id}><input type="checkbox" checked={candidate.enabled} onChange={(event) => setRouteEditor({ ...routeEditor, candidates: routeEditor.candidates.map((item) => item.id === candidate.id ? { ...item, enabled: event.target.checked } : item) })} /><strong>{candidate.kind === "direct" ? "直连" : candidate.kind === "proxy" ? "代理" : "SSH 跳板"}</strong>{candidate.kind === "proxy" && <select value={candidate.proxyId ?? ""} onChange={(event) => setRouteEditor({ ...routeEditor, candidates: routeEditor.candidates.map((item) => item.id === candidate.id ? { ...item, proxyId: event.target.value } : item) })}>{proxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.name}</option>)}</select>}{candidate.kind === "jump_host" && <select value={candidate.jumpConnectionId ?? ""} onChange={(event) => setRouteEditor({ ...routeEditor, candidates: routeEditor.candidates.map((item) => item.id === candidate.id ? { ...item, jumpConnectionId: event.target.value } : item) })}>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select>}<button type="button" title="移除" onClick={() => setRouteEditor({ ...routeEditor, candidates: routeEditor.candidates.filter((item) => item.id !== candidate.id) })}><Trash2 size={14} /></button></div>)}</div>}
      </Modal>
    </>
  );
}
