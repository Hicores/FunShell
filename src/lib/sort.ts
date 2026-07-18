export type SortDirection = "asc" | "desc";
export type SortValue = string | number | null | undefined;

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function nextSortState<K extends string>(current: SortState<K> | null, key: K, defaultDirection: SortDirection = "asc"): SortState<K> {
  return current?.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: defaultDirection };
}

export function sortRows<T>(rows: readonly T[], valueOf: (row: T) => SortValue, direction: SortDirection) {
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row) }))
    .sort((left, right) => {
      const leftMissing = left.value == null || (typeof left.value === "number" && !Number.isFinite(left.value));
      const rightMissing = right.value == null || (typeof right.value === "number" && !Number.isFinite(right.value));
      if (leftMissing || rightMissing) {
        if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
        return left.index - right.index;
      }
      const compared = typeof left.value === "number" && typeof right.value === "number"
        ? left.value - right.value
        : naturalCollator.compare(String(left.value), String(right.value));
      return (direction === "asc" ? compared : -compared) || left.index - right.index;
    })
    .map(({ row }) => row);
}
