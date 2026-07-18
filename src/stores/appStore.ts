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
  reconnect: (sessionId: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  openWorkspace: (kind: Exclude<WorkspaceKind, "terminal">) => void;
  setSnapshot: (sessionId: string, snapshot: ServerSnapshot) => void;
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
      const [connections, folders, keys, proxies, routes, tunnelProfiles] = await Promise.all([
        api.listConnections(), api.listFolders(), api.listKeys(), api.listProxies(), api.listRoutes(), api.tunnelProfiles(),
      ]);
      set({ connections, folders, keys, proxies, routes, tunnelProfiles, initialized: true });
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
    set({ busy: true, toast: null });
    const connectOnce = () => api.connectSession(connection.id);
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
        if (!accepted) return;
        await api.trustHost(hostKey.host, hostKey.port, hostKey.algorithm, hostKey.fingerprint);
        session = await connectOnce();
      }
      const tab: WorkspaceTab = {
        id: session.id,
        sessionId: session.id,
        connectionId: connection.id,
        title: connection.name,
        kind: "terminal",
        state: session.state,
      };
      set((state) => ({ sessions: [...state.sessions, session], tabs: [...state.tabs, tab], activeTabId: tab.id }));
      if (!isTauri()) set((state) => ({ snapshots: { ...state.snapshots, [session.id]: mockSnapshot } }));
    } catch (error) {
      set({ toast: String(error) });
    } finally {
      set({ busy: false });
    }
  },

  reconnect: async (sessionId) => {
    const state = get();
    const related = state.tabs.filter((tab) => tab.sessionId === sessionId);
    const terminal = related.find((tab) => tab.kind === "terminal");
    const connection = state.connections.find((item) => item.id === terminal?.connectionId);
    if (!terminal || !connection) return;
    set((current) => ({ tabs: current.tabs.map((tab) => tab.sessionId === sessionId ? { ...tab, state: "connecting" } : tab), toast: null }));
    try {
      await api.disconnectSession(sessionId).catch(() => undefined);
      const session = await api.connectSession(connection.id);
      const idMap = new Map(related.map((tab) => [tab.id, tab.kind === "terminal" ? session.id : `${session.id}:${tab.kind}`]));
      set((current) => {
        const snapshots = { ...current.snapshots };
        delete snapshots[sessionId];
        if (!isTauri()) snapshots[session.id] = mockSnapshot;
        return {
          sessions: [...current.sessions.filter((item) => item.id !== sessionId), session],
          tabs: current.tabs.map((tab) => tab.sessionId === sessionId ? { ...tab, id: idMap.get(tab.id)!, sessionId: session.id, state: session.state } : tab),
          activeTabId: current.activeTabId ? idMap.get(current.activeTabId) ?? current.activeTabId : null,
          snapshots,
          toast: "服务器已重新连接",
        };
      });
    } catch (error) {
      set((current) => ({
        tabs: current.tabs.map((tab) => tab.sessionId === sessionId ? { ...tab, state: "error" } : tab),
        toast: `重新连接失败: ${String(error)}`,
      }));
    }
  },

  closeTab: async (id) => {
    const state = get();
    const tab = state.tabs.find((item) => item.id === id);
    const remaining = state.tabs.filter((item) => item.id !== id);
    if (tab?.kind === "terminal" && !remaining.some((item) => item.sessionId === tab.sessionId)) {
      await api.disconnectSession(tab.sessionId).catch(() => undefined);
    }
    set({ tabs: remaining, activeTabId: remaining.at(-1)?.id ?? null });
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
    const id = `${terminal.sessionId}:${kind}`;
    if (state.tabs.some((tab) => tab.id === id)) {
      set({ activeTabId: id });
      return;
    }
    const names: Record<string, string> = { system: "系统信息", processes: "进程", network: "网络", tunnels: "隧道" };
    const tab: WorkspaceTab = { ...terminal, id, title: `${names[kind]}-${terminal.title}`, kind };
    set({ tabs: [...state.tabs, tab], activeTabId: id, toolsOpen: false });
  },

  setSnapshot: (sessionId, snapshot) => set((state) => ({ snapshots: { ...state.snapshots, [sessionId]: snapshot } })),
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
