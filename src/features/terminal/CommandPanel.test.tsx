import { describe, expect, it, vi } from "vitest";
import { resolvePresetVariables } from "./CommandPanel";

describe("command preset variables", () => {
  it("asks once per variable and replaces all occurrences", () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("nginx");
    expect(resolvePresetVariables("systemctl restart ${service} && status ${service}"))
      .toBe("systemctl restart nginx && status nginx");
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("stops insertion when variable input is canceled", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    expect(resolvePresetVariables("echo ${value}")).toBeNull();
  });
});
