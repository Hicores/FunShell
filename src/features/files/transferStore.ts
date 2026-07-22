import { create } from "zustand";
import type { TransferProgressEvent } from "../../types";

const EMPTY_TRANSFERS: TransferProgressEvent[] = [];
export const MAX_RUNTIME_TRANSFERS = 500;

function groupTransfers(transfers: TransferProgressEvent[]) {
  return transfers.reduce<Record<string, TransferProgressEvent[]>>((grouped, task) => {
    (grouped[task.sessionId] ??= []).push(task);
    return grouped;
  }, {});
}

function recentTransfers(transfers: TransferProgressEvent[]) {
  return [...transfers]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_RUNTIME_TRANSFERS);
}

interface TransferStore {
  bySession: Record<string, TransferProgressEvent[]>;
  viewing: boolean;
  hydrate: (transfers: TransferProgressEvent[]) => void;
  record: (task: TransferProgressEvent) => void;
  markViewed: () => void;
  setViewing: (viewing: boolean) => void;
  clearCompleted: () => void;
}

export const useTransferStore = create<TransferStore>((set) => ({
  bySession: {},
  viewing: false,
  hydrate: (transfers) => set((state) => ({
    bySession: groupTransfers(recentTransfers(transfers.map((task) => (
      state.viewing && !task.viewed ? { ...task, viewed: true } : task
    )))),
  })),
  record: (task) => set((state) => {
    const current = Object.values(state.bySession).flat();
    const existing = current.find((item) => item.taskId === task.taskId);
    const nextTask = { ...task, viewed: state.viewing || existing?.viewed || task.viewed };
    const next = recentTransfers([nextTask, ...current.filter((item) => item.taskId !== task.taskId)]);
    return { bySession: groupTransfers(next) };
  }),
  markViewed: () => set((state) => ({
    bySession: Object.fromEntries(Object.entries(state.bySession).map(([sessionId, transfers]) => [
      sessionId,
      transfers.map((task) => task.viewed ? task : { ...task, viewed: true }),
    ])),
  })),
  setViewing: (viewing) => set({ viewing }),
  clearCompleted: () => set((state) => ({
    bySession: groupTransfers(Object.values(state.bySession).flat().filter((task) => task.state === "running")),
  })),
}));

export function sessionTransfers(state: TransferStore, sessionId: string) {
  return state.bySession[sessionId] ?? EMPTY_TRANSFERS;
}

export function unreadTransferCount(state: TransferStore) {
  return Object.values(state.bySession).reduce(
    (count, transfers) => count + transfers.filter((task) => !task.viewed).length,
    0,
  );
}

export function runningTransferCount(state: TransferStore) {
  return Object.values(state.bySession).reduce(
    (count, transfers) => count + transfers.filter((task) => task.state === "running").length,
    0,
  );
}
