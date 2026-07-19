export function formatBytes(value: number, decimals = 1) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : decimals)} ${units[index]}`;
}

export function formatRate(value: number) {
  return `${formatBytes(value)}/s`;
}

export function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

type PermissionFileKind = "directory" | "file" | "symlink" | "other";

export function formatMode(mode: number | null, kind: PermissionFileKind = "file") {
  if (mode == null) return "-";
  const prefix = kind === "directory" ? "d" : kind === "symlink" ? "l" : kind === "other" ? "?" : "-";
  const output = [prefix, "-", "-", "-", "-", "-", "-", "-", "-", "-"];
  const groups = [
    [0o400, 0o200, 0o100],
    [0o040, 0o020, 0o010],
    [0o004, 0o002, 0o001],
  ];
  groups.forEach((bits, groupIndex) => {
    if (mode & bits[0]) output[groupIndex * 3 + 1] = "r";
    if (mode & bits[1]) output[groupIndex * 3 + 2] = "w";
    if (mode & bits[2]) output[groupIndex * 3 + 3] = "x";
  });
  if (mode & 0o4000) output[3] = mode & 0o100 ? "s" : "S";
  if (mode & 0o2000) output[6] = mode & 0o010 ? "s" : "S";
  if (mode & 0o1000) output[9] = mode & 0o001 ? "t" : "T";
  return output.join("");
}

export function formatIdentity(name: string | null | undefined, id: number | null | undefined) {
  return name ?? (id != null ? String(id) : "-");
}
