import { describe, expect, it } from "vitest";
import { nextSortState, sortRows } from "./sort";

describe("table sorting", () => {
  it("sorts numeric values and keeps unknown values last", () => {
    const rows = [{ rate: null }, { rate: 10 }, { rate: 200 }, { rate: 0 }];
    expect(sortRows(rows, (row) => row.rate, "desc").map((row) => row.rate)).toEqual([200, 10, 0, null]);
    expect(sortRows(rows, (row) => row.rate, "asc").map((row) => row.rate)).toEqual([0, 10, 200, null]);
  });

  it("uses natural text ordering and toggles the active column", () => {
    expect(sortRows(["eth10", "eth2", "eth1"], (value) => value, "asc")).toEqual(["eth1", "eth2", "eth10"]);
    expect(nextSortState({ key: "name", direction: "asc" }, "name")).toEqual({ key: "name", direction: "desc" });
    expect(nextSortState({ key: "name", direction: "asc" }, "rate", "desc")).toEqual({ key: "rate", direction: "desc" });
  });
});
