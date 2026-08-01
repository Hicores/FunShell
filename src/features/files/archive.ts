function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function archiveTimestamp(date = new Date()) {
  return `${date.getFullYear()}${padDatePart(date.getMonth() + 1)}${padDatePart(date.getDate())}-${padDatePart(date.getHours())}${padDatePart(date.getMinutes())}${padDatePart(date.getSeconds())}`;
}

export function defaultArchiveName(fileName: string, date = new Date()) {
  return `${fileName}.${archiveTimestamp(date)}.tar.gz`;
}

export function normalizeArchiveName(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\/\0\r\n]/.test(trimmed)) return null;
  return trimmed.toLocaleLowerCase().endsWith(".tar.gz") ? trimmed : `${trimmed}.tar.gz`;
}

export function isTarGzipArchive(fileName: string) {
  return fileName.toLocaleLowerCase().endsWith(".tar.gz");
}
