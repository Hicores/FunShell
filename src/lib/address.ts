function restoreAddress(core: string, zone: string, bracketed: boolean) {
  const value = `${core}${zone}`;
  return bracketed ? `[${value}]` : value;
}

export function maskIpAddress(address: string) {
  const value = address.trim();
  const bracketed = value.startsWith("[") && value.endsWith("]");
  const unwrapped = bracketed ? value.slice(1, -1) : value;
  const zoneIndex = unwrapped.indexOf("%");
  const core = zoneIndex >= 0 ? unwrapped.slice(0, zoneIndex) : unwrapped;
  const zone = zoneIndex >= 0 ? unwrapped.slice(zoneIndex) : "";
  const ipv4 = core.split(".");
  if (ipv4.length === 4 && ipv4.every((part) => /^\d{1,3}$/.test(part))) {
    return restoreAddress(`${ipv4[0]}.***.${ipv4[3]}`, zone, bracketed);
  }
  if (core.includes(":")) {
    const segments = core.split(":").filter(Boolean);
    if (segments.length >= 2) {
      return restoreAddress(`${segments[0]}:***:${segments.at(-1)}`, zone, bracketed);
    }
    if (segments.length === 1) {
      return restoreAddress(`***:${segments[0]}`, zone, bracketed);
    }
    return restoreAddress("***", zone, bracketed);
  }
  return value;
}

export function displayIpAddress(address: string, revealed: boolean) {
  return revealed ? address : maskIpAddress(address);
}
