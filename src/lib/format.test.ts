import { describe, expect, it } from "vitest";
import { formatMode } from "./format";

describe("formatMode", () => {
  it("formats regular files and directories as symbolic permissions", () => {
    expect(formatMode(0o644, "file")).toBe("-rw-r--r--");
    expect(formatMode(0o755, "directory")).toBe("drwxr-xr-x");
    expect(formatMode(0o700, "symlink")).toBe("lrwx------");
  });

  it("preserves setuid, setgid, and sticky markers", () => {
    expect(formatMode(0o4755, "file")).toBe("-rwsr-xr-x");
    expect(formatMode(0o2750, "directory")).toBe("drwxr-s---");
    expect(formatMode(0o1777, "directory")).toBe("drwxrwxrwt");
    expect(formatMode(0o4000, "file")).toBe("---S------");
  });
});
