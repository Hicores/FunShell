import { describe, expect, it } from "vitest";
import { archiveTimestamp, defaultArchiveName, isTarGzipArchive, normalizeArchiveName } from "./archive";

describe("archive helpers", () => {
  const date = new Date(2026, 7, 1, 20, 30, 5);

  it("builds a stable local timestamp and default archive name", () => {
    expect(archiveTimestamp(date)).toBe("20260801-203005");
    expect(defaultArchiveName("my app", date)).toBe("my app.20260801-203005.tar.gz");
  });

  it("normalizes tar.gz names", () => {
    expect(normalizeArchiveName(" backup ")).toBe("backup.tar.gz");
    expect(normalizeArchiveName("backup.TAR.GZ")).toBe("backup.TAR.GZ");
  });

  it.each(["", "   ", ".", "..", "nested/backup", "bad\0name", "bad\r\nname"])(
    "rejects an invalid archive name: %j",
    (name) => {
      expect(normalizeArchiveName(name)).toBeNull();
    },
  );

  it("recognizes tar.gz archives without case sensitivity", () => {
    expect(isTarGzipArchive("release.tar.gz")).toBe(true);
    expect(isTarGzipArchive("release.TAR.GZ")).toBe(true);
    expect(isTarGzipArchive("release.tar")).toBe(false);
  });
});
