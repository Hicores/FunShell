import { describe, expect, it } from "vitest";
import { displayIpAddress, maskIpAddress } from "./address";

describe("IP address display", () => {
  it("keeps only the first and last IPv4 octets by default", () => {
    expect(maskIpAddress("192.168.10.42")).toBe("192.***.42");
  });

  it("keeps only the first and last IPv6 segments by default", () => {
    expect(maskIpAddress("2001:db8:0:0:0:0:0:42")).toBe("2001:***:42");
    expect(maskIpAddress("fe80::42%eth0")).toBe("fe80:***:42%eth0");
  });

  it("leaves host names unchanged and reveals the original address on demand", () => {
    expect(maskIpAddress("server.example.com")).toBe("server.example.com");
    expect(displayIpAddress("192.168.10.42", true)).toBe("192.168.10.42");
  });
});
