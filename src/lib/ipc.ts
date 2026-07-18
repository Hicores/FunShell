import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import {
  mockConnections,
  mockFolders,
  mockProcesses,
  mockRemoteFiles,
  mockSnapshot,
  mockSockets,
  mockSystemInfo,
} from "./mock";
import type {
  AppSettings,
  CommandHistoryEntry,
  CommandPreset,
  ConnectionFolder,
  ConnectionProfile,
  KeyProfile,
  ProcessDetails,
  ProcessInfo,
  ProxyProfile,
  RemoteFileEntry,
  RouteProfile,
  SaveConnectionInput,
  ServerSnapshot,
  SessionDescriptor,
  SocketInfo,
  SystemInfo,
  TunnelProfile,
  TunnelRuntime,
  VaultStatus,
  GeoIpInfo,
} from "../types";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

const mockHistory: CommandHistoryEntry[] = [];
const mockPresets: CommandPreset[] = [
  { id: "preset-health", scope: "global", scopeId: null, name: "服务健康检查", command: "systemctl --no-pager --failed", tags: ["systemd"], sortOrder: 0 },
  { id: "preset-disk", scope: "global", scopeId: null, name: "磁盘占用", command: "du -sh * | sort -h", tags: ["storage"], sortOrder: 1 },
  { id: "preset-restart", scope: "global", scopeId: null, name: "重启服务", command: "systemctl restart ${service}", tags: ["systemd"], sortOrder: 2 },
];
let mockSettings: AppSettings = {
  geoipEnabled: true,
  geoipProviderUrl: "https://ipwho.is/{ip}",
  confirmCloseActiveSessions: true,
};
let mockSessionSequence = 0;
let mockSocketTick = 0;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) return invoke<T>(command, args);
  return mockCall(command, args) as T;
}

function mockCall(command: string, args?: Record<string, unknown>): unknown {
  switch (command) {
    case "list_connections": return [...mockConnections];
    case "list_folders": return [...mockFolders];
    case "list_keys": return [];
    case "list_proxies": return [];
    case "list_routes": return [];
    case "list_tunnel_profiles": return [];
    case "list_tunnel_statuses": return [];
    case "vault_status": return { mode: "dpapi", initialized: false, unlocked: true } satisfies VaultStatus;
    case "get_settings": return { ...mockSettings };
    case "save_settings": {
      mockSettings = { ...(args?.settings as AppSettings) };
      return { ...mockSettings };
    }
    case "lookup_geo_ip": {
      const ip = String(args?.ip ?? "");
      const privateAddress = ip.startsWith("10.") || ip.startsWith("192.168.") || ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0";
      return {
        ip,
        private: privateAddress,
        country: privateAddress ? null : "中国",
        region: privateAddress ? null : "广东",
        city: privateAddress ? null : "深圳",
        isp: privateAddress ? null : "演示网络",
        latitude: privateAddress ? null : 22.5431,
        longitude: privateAddress ? null : 114.0579,
        cachedAt: new Date().toISOString(),
      } satisfies GeoIpInfo;
    }
    case "connect_session": {
      const connection = mockConnections.find((item) => item.id === args?.connectionId) ?? mockConnections[0];
      return { id: `mock-${Date.now()}-${++mockSessionSequence}`, connectionId: connection.id, title: connection.name, state: "connected" } satisfies SessionDescriptor;
    }
    case "collect_server_snapshot": return mockSnapshot;
    case "get_system_info": return mockSystemInfo;
    case "list_processes": return mockProcesses;
    case "get_process_details": {
      const process = mockProcesses.find((item) => item.pid === args?.pid) ?? mockProcesses[0];
      return { pid: process.pid, name: process.name, executable: `/usr/bin/${process.name}`, workingDirectory: "/opt/apps", command: process.command, environment: { HOME: "/root", LANG: "en_US.UTF-8", PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin" } } satisfies ProcessDetails;
    }
    case "list_sockets": {
      mockSocketTick += 1;
      return mockSockets.map((socket, index) => ({
        ...socket,
        sentBytes: socket.sentBytes == null ? null : socket.sentBytes + mockSocketTick * (index + 1) * 2_400,
        receivedBytes: socket.receivedBytes == null ? null : socket.receivedBytes + mockSocketTick * (index + 1) * 1_700,
      }));
    }
    case "trace_route": return {
      target: String(args?.target ?? "8.8.8.8"),
      remote: Boolean(args?.remote ?? true),
      output: [
        `tracepath to ${String(args?.target ?? "8.8.8.8")}, 30 hops max`,
        " 1?: [LOCALHOST]                      pmtu 1500",
        " 1:  10.0.0.1                         0.624ms",
        " 2:  100.64.0.1                       4.182ms",
        ` 3:  ${String(args?.target ?? "8.8.8.8")}                     18.731ms reached`,
      ].join("\n"),
    };
    case "list_remote_files": return mockRemoteFiles;
    case "list_command_history": return mockHistory;
    case "list_command_presets": return mockPresets;
    case "save_command_preset": {
      const preset = args?.preset as CommandPreset;
      const saved = { ...preset, id: preset.id || `preset-${Date.now()}` };
      const index = mockPresets.findIndex((item) => item.id === saved.id);
      if (index >= 0) mockPresets[index] = saved;
      else mockPresets.push(saved);
      return saved;
    }
    case "delete_command_preset": {
      const index = mockPresets.findIndex((item) => item.id === args?.id);
      if (index >= 0) mockPresets.splice(index, 1);
      return null;
    }
    case "set_command_favorite": {
      const entry = mockHistory.find((item) => item.id === args?.id);
      if (entry) entry.favorite = Boolean(args?.favorite);
      return null;
    }
    case "clear_command_history": mockHistory.splice(0); return null;
    case "submit_terminal_command": {
      const commandText = String(args?.command ?? "");
      if (commandText) mockHistory.unshift({ id: String(Date.now()), connectionId: null, command: commandText, favorite: false, executedAt: new Date().toISOString() });
      return null;
    }
    case "save_connection": return { ...mockConnections[0], ...(args?.input as object), id: (args?.input as SaveConnectionInput)?.id ?? `connection-${Date.now()}` };
    default: return null;
  }
}

export async function onEvent<T>(name: string, callback: EventCallback<T>): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen(name, callback);
}

export const api = {
  getSettings: () => call<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => call<AppSettings>("save_settings", { settings }),
  geoIp: (ip: string) => call<GeoIpInfo>("lookup_geo_ip", { ip }),
  listConnections: (includeDeleted = false) => call<ConnectionProfile[]>("list_connections", { includeDeleted }),
  saveConnection: (input: SaveConnectionInput) => call<ConnectionProfile>("save_connection", { input }),
  deleteConnection: (id: string, deleted = true) => call<void>("delete_connection", { id, deleted }),
  listFolders: (includeDeleted = false) => call<ConnectionFolder[]>("list_folders", { includeDeleted }),
  saveFolder: (folder: ConnectionFolder) => call<ConnectionFolder>("save_folder", { folder }),
  deleteFolder: (id: string, deleted = true) => call<void>("delete_folder", { id, deleted }),
  listKeys: () => call<KeyProfile[]>("list_keys"),
  importKey: (name: string, privateKey: string, passphrase?: string) => call<KeyProfile>("import_private_key", { name, privateKey, passphrase }),
  generateKey: (name: string, algorithm: string) => call<KeyProfile>("generate_private_key", { name, algorithm }),
  deleteKey: (id: string) => call<void>("delete_key", { id }),
  listProxies: () => call<ProxyProfile[]>("list_proxies"),
  saveProxy: (input: { id?: string; name: string; kind: "http_connect" | "socks5"; host: string; port: number; username?: string | null; password?: string | null }) => call<ProxyProfile>("save_proxy", { input }),
  listRoutes: () => call<RouteProfile[]>("list_routes"),
  saveRoute: (route: RouteProfile) => call<RouteProfile>("save_route", { route }),
  connectSession: (connectionId: string, columns = 120, rows = 32) => call<SessionDescriptor>("connect_session", { connectionId, columns, rows }),
  disconnectSession: (sessionId: string) => call<void>("disconnect_session", { sessionId }),
  terminalInput: (sessionId: string, dataBase64: string) => call<void>("send_terminal_input", { sessionId, dataBase64 }),
  terminalCommand: (sessionId: string, command: string) => call<void>("submit_terminal_command", { sessionId, command }),
  resizeTerminal: (sessionId: string, columns: number, rows: number) => call<void>("resize_terminal", { sessionId, columns, rows }),
  trustHost: (host: string, port: number, algorithm: string, fingerprint: string) => call<void>("trust_host_key", { info: { host, port, algorithm, fingerprint } }),
  snapshot: (sessionId: string) => call<ServerSnapshot>("collect_server_snapshot", { sessionId }),
  systemInfo: (sessionId: string) => call<SystemInfo>("get_system_info", { sessionId }),
  processes: (sessionId: string) => call<ProcessInfo[]>("list_processes", { sessionId }),
  processDetails: (sessionId: string, pid: number) => call<ProcessDetails>("get_process_details", { sessionId, pid }),
  terminateProcess: (sessionId: string, pid: number, force = false) => call<void>("terminate_process", { sessionId, pid, force }),
  sockets: (sessionId: string) => call<SocketInfo[]>("list_sockets", { sessionId }),
  remoteFiles: (sessionId: string, path: string) => call<RemoteFileEntry[]>("list_remote_files", { sessionId, path }),
  readRemoteText: (sessionId: string, path: string) => call<{ path: string; content: string; size: number }>("read_remote_text", { sessionId, path }),
  writeRemoteText: (sessionId: string, path: string, content: string) => call<void>("write_remote_text", { sessionId, path, content }),
  createRemoteDirectory: (sessionId: string, path: string) => call<void>("create_remote_directory", { sessionId, path }),
  renameRemotePath: (sessionId: string, from: string, to: string) => call<void>("rename_remote_path", { sessionId, from, to }),
  deleteRemotePath: (sessionId: string, path: string, directory: boolean, recursive = false) => call<void>("delete_remote_path", { sessionId, path, directory, recursive }),
  chmodRemotePath: (sessionId: string, path: string, mode: number) => call<void>("chmod_remote_path", { sessionId, path, mode }),
  uploadRemoteFile: (sessionId: string, localPath: string, remotePath: string) => call<string>("upload_remote_file", { sessionId, localPath, remotePath }),
  downloadRemoteFile: (sessionId: string, remotePath: string, localPath: string) => call<string>("download_remote_file", { sessionId, remotePath, localPath }),
  cancelTransfer: (taskId: string) => call<void>("cancel_file_transfer", { taskId }),
  openRemoteFile: (sessionId: string, remotePath: string) => call<string>("open_remote_file", { sessionId, remotePath }),
  history: (connectionId?: string, search?: string) => call<CommandHistoryEntry[]>("list_command_history", { connectionId, search, limit: 300 }),
  favoriteHistory: (id: string, favorite: boolean) => call<void>("set_command_favorite", { id, favorite }),
  clearHistory: (connectionId?: string) => call<void>("clear_command_history", { connectionId }),
  presets: () => call<CommandPreset[]>("list_command_presets"),
  savePreset: (preset: CommandPreset) => call<CommandPreset>("save_command_preset", { preset }),
  deletePreset: (id: string) => call<void>("delete_command_preset", { id }),
  tunnelProfiles: () => call<TunnelProfile[]>("list_tunnel_profiles"),
  saveTunnel: (profile: TunnelProfile) => call<TunnelProfile>("save_tunnel_profile", { profile }),
  deleteTunnel: (id: string) => call<void>("delete_tunnel_profile", { id }),
  startTunnel: (profileId: string, sessionId: string) => call<TunnelRuntime>("start_tunnel", { profileId, sessionId }),
  stopTunnel: (profileId: string) => call<void>("stop_tunnel", { profileId }),
  tunnelStatuses: () => call<TunnelRuntime[]>("list_tunnel_statuses"),
  vaultStatus: () => call<VaultStatus>("vault_status"),
  initializeMasterVault: (password: string) => call<void>("initialize_master_vault", { password }),
  unlockMasterVault: (password: string) => call<void>("unlock_master_vault", { password }),
  lockMasterVault: () => call<void>("lock_master_vault"),
  changeVaultMode: (mode: "dpapi" | "master_password", password?: string) => call<void>("change_vault_mode", { mode, password }),
  traceRoute: (sessionId: string, target: string, remote = true) => call<{ target: string; remote: boolean; output: string }>("trace_route", { sessionId, target, remote }),
};
