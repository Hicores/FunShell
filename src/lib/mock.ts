import type {
  ConnectionFolder,
  ConnectionProfile,
  FilesystemInfo,
  ProcessInfo,
  RemoteFileEntry,
  ServerSnapshot,
  SocketInfo,
  SystemInfo,
} from "../types";

const now = new Date().toISOString();

export const mockFolders: ConnectionFolder[] = [
  { id: "folder-production", parentId: null, name: "生产环境", sortOrder: 0, deleted: false },
  { id: "folder-edge", parentId: null, name: "边缘节点", sortOrder: 1, deleted: false },
];

export const mockConnections: ConnectionProfile[] = [
  ["gateway-core", "模块-腾讯云Gateway", "139.155.253.229", "folder-production"],
  ["gateway-edge", "模块-边缘网关", "1.14.122.236", "folder-production"],
  ["server-hk", "香港-HK-01", "43.129.240.60", "folder-edge"],
  ["server-us", "美国-US-01", "45.92.29.68", "folder-edge"],
].map(([id, name, host, folderId], index) => ({
  id,
  folderId,
  name,
  host,
  port: 22,
  username: "root",
  authMethod: "password",
  secretId: null,
  keyId: null,
  routeId: null,
  startupCommand: null,
  keepaliveSeconds: 30,
  connectTimeoutSeconds: 10,
  compression: false,
  autoReconnect: true,
  sortOrder: index,
  deleted: false,
  createdAt: now,
  updatedAt: now,
}));

const filesystems: FilesystemInfo[] = [
  { device: "/dev/vda1", mountPoint: "/", total: 42_200_000_000, used: 25_900_000_000, available: 16_300_000_000, usagePercent: 61.4 },
  { device: "tmpfs", mountPoint: "/run", total: 1_030_000_000, used: 2_100_000, available: 1_027_900_000, usagePercent: 0.2 },
];

const processes: ProcessInfo[] = [
  { pid: 151137, user: "root", memoryBytes: 591_000_000, cpuPercent: 9.1, name: "java", command: "/usr/bin/java -jar /opt/apps/gateway.jar" },
  { pid: 2137, user: "root", memoryBytes: 67_000_000, cpuPercent: 3.0, name: "monitor", command: "/opt/monitor/agent" },
  { pid: 488485, user: "www", memoryBytes: 14_800_000, cpuPercent: 1.2, name: "nginx", command: "nginx: worker process" },
  { pid: 778, user: "root", memoryBytes: 12_000_000, cpuPercent: 0.7, name: "sshd", command: "sshd: root@pts/0" },
];

export const mockSnapshot: ServerSnapshot = {
  uptimeSeconds: 20 * 86400 + 3500,
  loadAverage: [0.19, 0.13, 0.11],
  cpuPercent: 18.5,
  memoryTotal: 2_040_000_000,
  memoryUsed: 1_120_000_000,
  swapTotal: 4_400_000_000,
  swapUsed: 610_000_000,
  interfaces: [
    { name: "eth0", receivedBytes: 2_900_000_000_000, transmittedBytes: 1_100_000_000_000, receiveBps: 1_420_000, transmitBps: 136_000 },
    { name: "tun0", receivedBytes: 1_800_000_000, transmittedBytes: 2_100_000_000, receiveBps: 62_000, transmitBps: 31_000 },
  ],
  filesystems,
  topProcesses: processes,
};

export const mockSystemInfo: SystemInfo = {
  operatingSystem: "Debian GNU/Linux 12",
  kernel: "Linux",
  kernelVersion: "6.1.0-47-amd64",
  architecture: "x86_64",
  hostname: "gateway-edge-01",
  cpuModel: "AMD EPYC 7K62 48-Core Processor",
  cpuCores: 2,
  cpuFrequencyMhz: 2595.124,
  cache: "512 KB",
  snapshot: mockSnapshot,
};

export const mockRemoteFiles: RemoteFileEntry[] = [
  { name: ".cache", path: "/root/.cache", kind: "directory", size: 0, modified: 1784000000, permissions: 0o755, user: "root", group: "root", userId: 0, groupId: 0 },
  { name: ".config", path: "/root/.config", kind: "directory", size: 0, modified: 1784100000, permissions: 0o755, user: "root", group: "root", userId: 0, groupId: 0 },
  { name: ".ssh", path: "/root/.ssh", kind: "directory", size: 0, modified: 1784200000, permissions: 0o700, user: "root", group: "root", userId: 0, groupId: 0 },
  { name: "gateway", path: "/root/gateway", kind: "directory", size: 0, modified: 1784300000, permissions: 0o755, user: "root", group: "root", userId: 0, groupId: 0 },
  { name: ".bash_history", path: "/root/.bash_history", kind: "file", size: 1840, modified: 1784400000, permissions: 0o600, user: "root", group: "root", userId: 0, groupId: 0 },
  { name: "deploy.sh", path: "/root/deploy.sh", kind: "file", size: 61120, modified: 1784500000, permissions: 0o755, user: "root", group: "root", userId: 0, groupId: 0 },
  { name: "gateway-release.tar.gz", path: "/root/gateway-release.tar.gz", kind: "file", size: 93_200_000, modified: 1784600000, permissions: 0o644, user: "root", group: "root", userId: 0, groupId: 0 },
];

export const mockSockets: SocketInfo[] = [
  { protocol: "tcp", addressFamily: "IPv4", interfaceName: null, state: "LISTEN", localAddress: "0.0.0.0", localPort: 80, remoteAddress: "0.0.0.0", remotePort: null, pid: 488485, process: "nginx", receivedBytes: null, sentBytes: null },
  { protocol: "tcp", addressFamily: "IPv4", interfaceName: null, state: "LISTEN", localAddress: "0.0.0.0", localPort: 22, remoteAddress: "0.0.0.0", remotePort: null, pid: 778, process: "sshd", receivedBytes: null, sentBytes: null },
  { protocol: "tcp", addressFamily: "IPv6", interfaceName: null, state: "LISTEN", localAddress: "::", localPort: 22, remoteAddress: "::", remotePort: null, pid: 778, process: "sshd", receivedBytes: null, sentBytes: null },
  { protocol: "tcp", addressFamily: "IPv6", interfaceName: "eth1", state: "LISTEN", localAddress: "2409:8a1e:8c20::10", localPort: 20008, remoteAddress: "::", remotePort: null, pid: 151137, process: "java", receivedBytes: null, sentBytes: null },
  { protocol: "tcp", addressFamily: "IPv4", interfaceName: "eth0", state: "ESTAB", localAddress: "1.14.122.236", localPort: 80, remoteAddress: "42.48.120.32", remotePort: 48251, pid: 488485, process: "nginx", receivedBytes: 697_000, sentBytes: 1_780_000 },
  { protocol: "tcp", addressFamily: "IPv4", interfaceName: "eth0", state: "ESTAB", localAddress: "1.14.122.236", localPort: 80, remoteAddress: "220.167.110.204", remotePort: 56071, pid: 488485, process: "nginx", receivedBytes: 221_000, sentBytes: 480_000 },
  { protocol: "tcp", addressFamily: "IPv4", interfaceName: "eth0", state: "ESTAB", localAddress: "1.14.122.236", localPort: 22, remoteAddress: "171.109.213.141", remotePort: 54133, pid: 778, process: "sshd", receivedBytes: 697_000, sentBytes: 1_780_000 },
  { protocol: "tcp", addressFamily: "IPv6", interfaceName: "eth1", state: "ESTAB", localAddress: "2409:8a1e:8c20::10", localPort: 20008, remoteAddress: "2408:8207:2450::18", remotePort: 62736, pid: 151137, process: "java", receivedBytes: 546, sentBytes: 36_600 },
];

export { processes as mockProcesses };
