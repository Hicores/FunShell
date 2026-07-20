import { describe, expect, it } from "vitest";
import { autoReconnectProgress, nextAutoReconnectAttempt } from "./reconnectPolicy";

describe("automatic reconnect policy", () => {
  it("allows unlimited attempts when the configured maximum is zero", () => {
    expect(nextAutoReconnectAttempt(0, 0)).toBe(1);
    expect(nextAutoReconnectAttempt(999, 0)).toBe(1000);
    expect(autoReconnectProgress(7, 0)).toBe("第 7 次");
  });

  it("stops after the configured number of attempts", () => {
    expect(nextAutoReconnectAttempt(0, 3)).toBe(1);
    expect(nextAutoReconnectAttempt(2, 3)).toBe(3);
    expect(nextAutoReconnectAttempt(3, 3)).toBeNull();
    expect(autoReconnectProgress(2, 3)).toBe("2/3");
  });
});
