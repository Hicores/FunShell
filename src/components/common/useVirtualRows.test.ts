import { describe, expect, it } from "vitest";
import { calculateVirtualRange } from "./useVirtualRows";

describe("calculateVirtualRange", () => {
  it("keeps only visible rows and overscan around the viewport", () => {
    expect(calculateVirtualRange(10_000, 2_700, 270, 27, 5)).toEqual({ start: 95, end: 115 });
  });

  it("uses a bounded fallback when layout has no measured height", () => {
    expect(calculateVirtualRange(10_000, 0, 0, 27, 8)).toEqual({ start: 0, end: 56 });
  });
});
