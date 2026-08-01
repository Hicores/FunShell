import { describe, expect, it } from "vitest";
import { defaultArchiveName, isTarGzipArchive, normalizeArchiveName } from "./archive";

describe("file archive helpers", () => {
  it("builds the reversible default tar.gz name from the item and current time", () => {
    expect(defaultArchiveName("gateway", new Date(2026, 7, 1, 20, 30, 45))).toBe("gateway.20260801-203045.tar.gz");
  });

  it("adds the tar.gz suffix to a custom archive name", () => {
    expect(normalizeArchiveName("nightly backup")).toBe("nightly backup.tar.gz");
    expect(normalizeArchiveName("nightly.tar.gz")).toBe("nightly.tar.gz");
  });

  it("rejects archive names that escape the current directory", () => {
    expect(normalizeArchiveName("../backup")).toBeNull();
    expect(normalizeArchiveName("folder/backup")).toBeNull();
  });

  it("recognizes tar.gz files case-insensitively", () => {
    expect(isTarGzipArchive("release.TAR.GZ")).toBe(true);
    expect(isTarGzipArchive("release.zip")).toBe(false);
  });
});
