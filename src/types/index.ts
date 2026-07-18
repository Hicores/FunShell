export type AuthMethod = "password" | "public_key";
export type ProxyKind = "http_connect" | "socks5";
export type RouteKind = "direct" | "proxy" | "jump_host";
export type TunnelKind = "local" | "remote" | "dynamic";

export interface ConnectionFolder {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  deleted: boolean;
}

export interface ConnectionProfile {
  id: string;
  folderId: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  secretId: string | null;
  keyId: string | null;
  routeId: string | null;
  startupCommand: string | null;
  keepaliveSeconds: number;
  connectTimeoutSeconds: number;
  compression: boolean;
  autoReconnect: boolean;
  sortOrder: number;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveConnectionInput {
  id?: string;
  folderId?: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password?: string | null;
  keyId?: string | null;
  routeId?: string | null;
  startupCommand?: string | null;
  keepaliveSeconds?: number;
  connectTimeoutSeconds?: number;
  compression: boolean;
  autoReconnect: boolean;
  sortOrder?: number;
}

export interface KeyProfile {
  id: string;
  name: string;
  algorithm: string;
  fingerprint: string;
  publicKey: string;
  createdAt: string;
}

export interface ProxyProfile {
  id: string;
  name: string;
  kind: ProxyKind;
  host: string;
  port: number;
  username: string | null;
  secretId: string | null;
}

export interface RouteCandidate {
  id: string;
  kind: RouteKind;
  proxyId: string | null;
  jumpConnectionId: string | null;
  enabled: boolean;
}

export interface RouteProfile {
  id: string;
  name: string;
  autoSelect: boolean;
  fixedCandidateId: string | null;
  candidates: RouteCandidate[];
}

export interface SessionDescriptor {
  id: string;
  connectionId: string;
  title: string;
  state: "connecting" | "connected" | "disconnected" | "error";
}

export type WorkspaceKind = "terminal" | "system" | "processes" | "network" | "tunnels";

export interface WorkspaceTab {
  id: string;
  sessionId: string;
  connectionId: string;
  title: string;
  kind: WorkspaceKind;
  state: SessionDescriptor["state"];
}

export interface ProcessInfo {
  pid: number;
  user: string;
  memoryBytes: number;
  cpuPercent: number;
  name: string;
  command: string;
}

export interface ProcessDetails {
  pid: number;
  name: string;
  executable: string;
  workingDirectory: string;
  command: string;
  environment: Record<string, string>;
}

export interface NetworkInterface {
  name: string;
  receivedBytes: number;
  transmittedBytes: number;
  receiveBps: number;
  transmitBps: number;
}

export interface FilesystemInfo {
  device: string;
  mountPoint: string;
  total: number;
  used: number;
  available: number;
  usagePercent: number;
}

export interface ServerSnapshot {
  uptimeSeconds: number;
  loadAverage: [number, number, number];
  cpuPercent: number;
  memoryTotal: number;
  memoryUsed: number;
  swapTotal: number;
  swapUsed: number;
  interfaces: NetworkInterface[];
  filesystems: FilesystemInfo[];
  topProcesses: ProcessInfo[];
}

export interface SystemInfo {
  operatingSystem: string;
  kernel: string;
  kernelVersion: string;
  architecture: string;
  hostname: string;
  cpuModel: string;
  cpuCores: number;
  cpuFrequencyMhz: number | null;
  cache: string | null;
  snapshot: ServerSnapshot;
}

export interface SocketInfo {
  protocol: string;
  addressFamily: string;
  interfaceName: string | null;
  state: string;
  localAddress: string;
  localPort: number | null;
  remoteAddress: string;
  remotePort: number | null;
  pid: number | null;
  process: string | null;
  receivedBytes: number | null;
  sentBytes: number | null;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  size: number;
  modified: number | null;
  permissions: number | null;
  user: string | null;
  group: string | null;
}

export interface CommandHistoryEntry {
  id: string;
  connectionId: string | null;
  command: string;
  favorite: boolean;
  executedAt: string;
}

export interface CommandPreset {
  id: string;
  scope: "global" | "folder" | "connection";
  scopeId: string | null;
  name: string;
  command: string;
  tags: string[];
  sortOrder: number;
}

export interface TunnelProfile {
  id: string;
  connectionId: string;
  name: string;
  kind: TunnelKind;
  bindHost: string;
  bindPort: number;
  targetHost: string | null;
  targetPort: number | null;
  autoStart: boolean;
}

export interface TunnelRuntime {
  profileId: string;
  sessionId: string;
  state: "running" | "stopped" | "error";
  boundPort: number;
  connections: number;
  uploadedBytes: number;
  downloadedBytes: number;
  error: string | null;
}

export interface TerminalOutputEvent {
  sessionId: string;
  dataBase64: string;
}

export interface SessionStatusEvent {
  sessionId: string;
  state: SessionDescriptor["state"];
  message: string | null;
}

export interface TransferProgressEvent {
  sessionId: string;
  taskId: string;
  direction: "upload" | "download";
  source: string;
  destination: string;
  transferred: number;
  total: number;
  state: "running" | "completed" | "error" | "canceled";
  updatedAt: string;
  viewed: boolean;
}

export interface VaultStatus {
  mode: "dpapi" | "master_password";
  initialized: boolean;
  unlocked: boolean;
}

export interface AppSettings {
  geoipEnabled: boolean;
  geoipProviderUrl: string;
  confirmCloseActiveSessions: boolean;
}

export interface GeoIpInfo {
  ip: string;
  private: boolean;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  latitude: number | null;
  longitude: number | null;
  cachedAt: string;
}
