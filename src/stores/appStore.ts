import { create } from "zustand";
import { api, isTauri } from "../lib/ipc";
import { mockSnapshot } from "../lib/mock";
import type {
  ConnectionFolder,
  ConnectionProfile,
  KeyProfile,
  ProxyProfile,
  RouteProfile,
  ServerSnapshot,
  SessionDescriptor,
  TunnelProfile,
  WorkspaceKind,
  WorkspaceTab,
} from "../types";

interface AppStore {
  initialized: boolean;
  busy: boolean;
  connections: ConnectionProfile[];
  folders: ConnectionFolder[];
  keys: KeyProfile[];
  proxies: ProxyProfile[];
  routes: RouteProfile[];
  tunnelProfiles: TunnelProfile[];
  sessions: SessionDescriptor[];
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  snapshots: Record<string, ServerSnapshot>;
  quickConnectionCollapsedFolderIds: string[];
  connectionManagerOpen: boolean;
  connectionEditorOpen: boolean;
  keyManagerOpen: boolean;
  settingsOpen: boolean;
  editingConnection: ConnectionProfile | null;
  newConnectionFolderId: string | null;
  toolsOpen: boolean;
  toast: string | null;
  initialize: () => Promise<void>;
  refreshConnections: () => Promise<void>;
  connect: (connection: ConnectionProfile) => Promise<void>;
  reconnect: (sessionId: string) => Promise<boolean>;
  closeTab: (id: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  openWorkspace: (kind: Exclude<WorkspaceKind, "terminal">) => void;
  setSnapshot: (sessionId: string, snapshot: ServerSnapshot) => void;
  setQuickConnectionFolderCollapsed: (folderId: string, collapsed: boolean) => Promise<void>;
  openConnectionManager: (open: boolean) => void;
  editConnection: (connection?: ConnectionProfile, folderId?: string | null) => void;
  closeConnectionEditor: () => void;
  openKeyManager: (open: boolean) => void;
  openSettings: (open: boolean) => void;
  toggleTools: () => void;
  notify: (message: string | null) => void;
}

function parseHostKey(error: unknown) {
  const message = String(error);
  const marker = message.includes("HOST_KEY_CHANGED|") ? "HOST_KEY_CHANGED|" : "HOST_KEY_REQUIRED|";
  const index = message.indexOf(marker);
  if (index < 0) return null;
  const [host, port, algorithm, fingerprint] = message.slice(index + marker.length).split("|");
  return { changed: marker.startsWith("HOST_KEY_CHANGED"), host, port: Number(port), algorithm, fingerprint };
}

function emitTerminalStatus(tabId: string, state: "connecting" | "connected" | "disconnected" | "reconnecting" | "reconnected" | "error", message: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("funshell-terminal-status", { detail: { tabId, state, message } }));
  }
}

export const useAppStore = create<AppStore>((set, get) => ({
  initialized: false,
  busy: false,
  connections: [],
  folders: [],
  keys: [],
  proxies: [],
  routes: [],
  tunnelProfiles: [],
  sessions: [],
  tabs: [],
  activeTabId: null,
  snapshots: {},
  quickConnectionCollapsedFolderIds: [],
  connectionManagerOpen: false,
  connectionEditorOpen: false,
  keyManagerOpen: false,
  settingsOpen: false,
  editingConnection: null,
  newConnectionFolderId: null,
  toolsOpen: false,
  toast: null,

  initialize: async () => {
    if (get().initialized) return;
    set({ busy: true });
    try {
      const [connections, folders, keys, proxies, routes, tunnelProfiles, settings] = await Promise.all([
        api.listConnections(), api.listFolders(), api.listKeys(), api.listProxies(), api.listRoutes(), api.tunnelProfiles(), api.getSettings(),
      ]);
      set({ connections, folders, keys, proxies, routes, tunnelProfiles, quickConnectionCollapsedFolderIds: settings.quickConnectionCollapsedFolderIds, initialized: true });
    } catch (error) {
      set({ toast: String(error), initialized: true });
    } finally {
      set({ busy: false });
    }
  },

  refreshConnections: async () => {
    const [connections, folders, keys, routes] = await Promise.all([
      api.listConnections(), api.listFolders(), api.listKeys(), api.listRoutes(),
    ]);
    set({ connections, folders, keys, routes });
  },

  connect: async (connection) => {
    const existing = get().tabs.find((tab) => tab.kind === "terminal" && tab.connectionId === connection.id && tab.state === "connecting");
    if (existing) {
      set({ activeTabId: existing.id, toast: null });
      return;
    }
    const requestedSessionId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pendingSession: SessionDescriptor = {
      id: requestedSessionId,
      connectionId: connection.id,
      title: connection.name,
      state: "connecting",
    };
    const pendingTab: WorkspaceTab = {
      id: requestedSessionId,
      sessionId: requestedSessionId,
      connectionId: connection.id,
      title: connection.name,
      kind: "terminal",
      state: "connecting",
    };
    set((state) => ({
      sessions: [...state.sessions, pendingSession],
      tabs: [...state.tabs, pendingTab],
      activeTabId: pendingTab.id,
      toast: null,
    }));
    const connectOnce = () => api.connectSession(connection.id, 120, 32, requestedSessionId);
    try {
      let session: SessionDescriptor;
      try {
        session = await connectOnce();
      } catch (error) {
        const hostKey = parseHostKey(error);
        if (!hostKey) throw error;
        const accepted = window.confirm(
          `${hostKey.changed ? "服务器主机指纹已变化" : "首次连接需要确认主机指纹"}\n\n${hostKey.algorithm}\n${hostKey.fingerprint}\n\n确认信任此主机？`,
        );
        if (!accepted) throw new Error("已取消主机指纹确认");
        await api.trustHost(hostKey.host, hostKey.port, hostKey.algorithm, hostKey.fingerprint);
        session = await connectOnce();
      }
      if (!get().tabs.some((tab) => tab.id === pendingTab.id)) {
        await api.disconnectSession(session.id).catch(() => undefined);
        set((state) => ({ sessions: state.sessions.filter((item) => item.id !== requestedSessionId) }));
        return;
      }
      set((state) => ({
        sessions: [...state.sessions.filter((item) => item.id !== requestedSessionId), session],
        tabs: state.tabs.map((tab) => tab.id === pendingTab.id ? { ...tab, sessionId: session.id, state: session.state } : tab),
        toast: `已连接 ${connection.name}`,
      }));
      if (!isTauri()) set((state) => ({ snapshots: { ...state.snapshots, [session.id]: mockSnapshot } }));
      emitTerminalStatus(pendingTab.id, "connected", "连接成功");
    } catch (error) {
      if (!get().tabs.some((tab) => tab.id === pendingTab.id)) {
        set((state) => ({ sessions: state.sessions.filter((item) => item.id !== requestedSessionId) }));
        return;
      }
      const message = `连接失败: ${String(error)}`;
      set((state) => ({
        sessions: state.sessions.map((item) => item.id === requestedSessionId ? { ...item, state: "error" } : item),
        tabs: state.tabs.map((tab) => tab.id === pendingTab.id ? { ...tab, state: "error" } : tab),
        toast: message,
      }));
      emitTerminalStatus(pendingTab.id, "error", message);
    }
  },

  reconnect: async (sessionId) => {
    const state = get();
    const related = state.tabs.filter((tab) => tab.sessionId === sessionId);
    const terminal = related.find((tab) => tab.kind === "terminal");
    const connection = state.connections.find((item) => item.id === terminal?.connectionId);
    if (!terminal || !connection) return false;
    emitTerminalStatus(terminal.id, "reconnecting", "正在重连...");
    set((current) => ({ tabs: current.tabs.map((tab) => tab.sessionId === sessionId ? { ...tab, state: "connecting" } : tab), toast: null }));
    try {
      await api.disconnectSession(sessionId).catch(() => undefined);
      const session = await api.connectSession(connection.id);
      if (!get().tabs.some((tab) => tab.id === terminal.id)) {
        await api.disconnectSession(session.id).catch(() => undefined);
        set((current) => ({ sessions: current.sessions.filter((item) => item.id !== sessionId) }));
        return false;
      }
      set((current) => {
        const snapshots = { ...current.snapshots };
        delete snapshots[sessionId];
        if (!isTauri()) snapshots[session.id] = mockSnapshot;
        return {
          sessions: [...current.sessions.filter((item) => item.id !== sessionId), session],
          tabs: current.tabs.map((tab) => tab.sessionId === sessionId ? { ...tab, sessionId: session.id, state: session.state } : tab),
          snapshots,
          toast: "服务器已重新连接",
        };
      });
      emitTerminalStatus(terminal.id, "reconnected", "已重新连接");
      return true;
    } catch (error) {
      set((current) => ({
        tabs: current.tabs.map((tab) => tab.sessionId === sessionId ? { ...tab, state: "error" } : tab),
        toast: `重新连接失败: ${String(error)}`,
      }));
      emitTerminalStatus(terminal.id, "error", `重连失败: ${String(error)}`);
      return false;
    }
  },

  closeTab: async (id) => {
    const state = get();
    const tab = state.tabs.find((item) => item.id === id);
    const remaining = state.tabs.filter((item) => item.id !== id);
    const disconnect = tab?.kind === "terminal" && !remaining.some((item) => item.sessionId === tab.sessionId);
    const snapshots = { ...state.snapshots };
    if (disconnect) delete snapshots[tab.sessionId];
    set({
      tabs: remaining,
      sessions: disconnect ? state.sessions.filter((item) => item.id !== tab.sessionId) : state.sessions,
      snapshots,
      activeTabId: state.activeTabId === id ? remaining.at(-1)?.id ?? null : state.activeTabId,
    });
    if (disconnect) {
      await api.disconnectSession(tab.sessionId).catch(() => undefined);
    }
  },

  setActiveTab: (activeTabId) => set({ activeTabId }),

  openWorkspace: (kind) => {
    const state = get();
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    const terminal = active?.sessionId
      ? state.tabs.find((tab) => tab.sessionId === active.sessionId && tab.kind === "terminal")
      : state.tabs.find((tab) => tab.kind === "terminal");
    if (!terminal) {
      set({ toast: "请先连接服务器" });
      return;
    }
    const id = `${terminal.id}:${kind}`;
    if (state.tabs.some((tab) => tab.id === id)) {
      set({ activeTabId: id });
      return;
    }
    const names: Record<string, string> = { system: "系统信息", processes: "进程", network: "网络", tunnels: "隧道" };
    const tab: WorkspaceTab = { ...terminal, id, title: `${names[kind]}-${terminal.title}`, kind };
    set({ tabs: [...state.tabs, tab], activeTabId: id, toolsOpen: false });
  },

  setSnapshot: (sessionId, snapshot) => set((state) => ({ snapshots: { ...state.snapshots, [sessionId]: snapshot } })),
  setQuickConnectionFolderCollapsed: async (folderId, collapsed) => {
    let folderIds: string[] = [];
    set((state) => {
      const next = new Set(state.quickConnectionCollapsedFolderIds);
      if (collapsed) next.add(folderId);
      else next.delete(folderId);
      folderIds = [...next];
      return { quickConnectionCollapsedFolderIds: folderIds };
    });
    try {
      await api.saveQuickConnectionCollapsedFolders(folderIds);
    } catch (error) {
      set({ toast: String(error) });
    }
  },
  openConnectionManager: (connectionManagerOpen) => set({ connectionManagerOpen }),
  editConnection: (editingConnection, folderId = null) => set({
    editingConnection: editingConnection ?? null,
    newConnectionFolderId: editingConnection ? null : folderId,
    connectionEditorOpen: true,
  }),
  closeConnectionEditor: () => set({ connectionEditorOpen: false, editingConnection: null, newConnectionFolderId: null }),
  openKeyManager: (keyManagerOpen) => set({ keyManagerOpen }),
  openSettings: (settingsOpen) => set({ settingsOpen }),
  toggleTools: () => set((state) => ({ toolsOpen: !state.toolsOpen })),
  notify: (toast) => set({ toast }),
}));
