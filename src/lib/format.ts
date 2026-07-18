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

export function formatMode(mode: number | null) {
  if (mode == null) return "-";
  return (mode & 0o7777).toString(8).padStart(3, "0");
}

export function formatIdentity(name: string | null | undefined, id: number | null | undefined) {
  if (name && id != null) return `${name} (${id})`;
  return name ?? (id != null ? String(id) : "-");
}
