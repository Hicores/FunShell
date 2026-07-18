import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDirection } from "../../lib/sort";

interface SortableHeaderProps<K extends string> {
  label: string;
  sortKey: K;
  activeKey?: K;
  direction?: SortDirection;
  defaultDirection?: SortDirection;
  onSort: (key: K, defaultDirection: SortDirection) => void;
}

export function SortableHeader<K extends string>({ label, sortKey, activeKey, direction, defaultDirection = "asc", onSort }: SortableHeaderProps<K>) {
  const active = activeKey === sortKey;
  const nextDirection = active && direction === "asc" ? "desc" : active && direction === "desc" ? "asc" : defaultDirection;
  return (
    <th className="sortable-column" aria-sort={active ? direction === "asc" ? "ascending" : "descending" : "none"}>
      <button className={active ? "sort-header active" : "sort-header"} type="button" title={`按${label}${nextDirection === "asc" ? "升序" : "降序"}排列`} onClick={() => onSort(sortKey, defaultDirection)}>
        <span>{label}</span>
        {active ? direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} />}
      </button>
    </th>
  );
}
