import { create } from "zustand";
import type { TransferProgressEvent } from "../../types";

const EMPTY_TRANSFERS: TransferProgressEvent[] = [];

interface TransferStore {
  bySession: Record<string, TransferProgressEvent[]>;
  record: (task: TransferProgressEvent) => void;
  clearCompleted: (sessionId: string) => void;
}

export const useTransferStore = create<TransferStore>((set) => ({
  bySession: {},
  record: (task) => set((state) => {
    const current = state.bySession[task.sessionId] ?? EMPTY_TRANSFERS;
    const next = [task, ...current.filter((item) => item.taskId !== task.taskId)].slice(0, 100);
    return { bySession: { ...state.bySession, [task.sessionId]: next } };
  }),
  clearCompleted: (sessionId) => set((state) => ({
    bySession: {
      ...state.bySession,
      [sessionId]: (state.bySession[sessionId] ?? EMPTY_TRANSFERS).filter((task) => task.state === "running"),
    },
  })),
}));

export function sessionTransfers(state: TransferStore, sessionId: string) {
  return state.bySession[sessionId] ?? EMPTY_TRANSFERS;
}
