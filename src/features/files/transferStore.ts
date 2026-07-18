import { create } from "zustand";
import type { TransferProgressEvent } from "../../types";

const EMPTY_TRANSFERS: TransferProgressEvent[] = [];

function groupTransfers(transfers: TransferProgressEvent[]) {
  return transfers.reduce<Record<string, TransferProgressEvent[]>>((grouped, task) => {
    (grouped[task.sessionId] ??= []).push(task);
    return grouped;
  }, {});
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
    bySession: groupTransfers(transfers.map((task) => (
      state.viewing && !task.viewed ? { ...task, viewed: true } : task
    ))),
  })),
  record: (task) => set((state) => {
    const current = state.bySession[task.sessionId] ?? EMPTY_TRANSFERS;
    const existing = current.find((item) => item.taskId === task.taskId);
    const nextTask = { ...task, viewed: state.viewing || existing?.viewed || task.viewed };
    const next = [nextTask, ...current.filter((item) => item.taskId !== task.taskId)].slice(0, 500);
    return { bySession: { ...state.bySession, [task.sessionId]: next } };
  }),
  markViewed: () => set((state) => ({
    bySession: Object.fromEntries(Object.entries(state.bySession).map(([sessionId, transfers]) => [
      sessionId,
      transfers.map((task) => task.viewed ? task : { ...task, viewed: true }),
    ])),
  })),
  setViewing: (viewing) => set({ viewing }),
  clearCompleted: () => set((state) => ({
    bySession: Object.fromEntries(Object.entries(state.bySession).map(([sessionId, transfers]) => [
      sessionId,
      transfers.filter((task) => task.state === "running"),
    ])),
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
