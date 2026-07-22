import { create } from "zustand";
import type { TransferProgressEvent } from "../../types";

const EMPTY_TRANSFERS: TransferProgressEvent[] = [];
export const MAX_RUNTIME_TRANSFERS = 500;
export const TRANSFER_SPEED_STALE_MS = 1_500;

export interface TransferRateSample {
  speedBps: number;
  sampledAt: number;
  transferred: number;
}

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
  rates: Record<string, TransferRateSample>;
  viewing: boolean;
  hydrate: (transfers: TransferProgressEvent[]) => void;
  record: (task: TransferProgressEvent) => void;
  markViewed: () => void;
  setViewing: (viewing: boolean) => void;
  clearCompleted: () => void;
}

export const useTransferStore = create<TransferStore>((set) => ({
  bySession: {},
  rates: {},
  viewing: false,
  hydrate: (transfers) => set((state) => ({
    bySession: groupTransfers(recentTransfers(transfers.map((task) => (
      state.viewing && !task.viewed ? { ...task, viewed: true } : task
    )))),
    rates: Object.fromEntries(transfers.filter((task) => task.state === "running").map((task) => [task.taskId, {
      speedBps: 0,
      sampledAt: Date.now(),
      transferred: task.transferred,
    }])),
  })),
  record: (task) => set((state) => {
    const current = Object.values(state.bySession).flat();
    const existing = current.find((item) => item.taskId === task.taskId);
    const nextTask = { ...task, viewed: state.viewing || existing?.viewed || task.viewed };
    const next = recentTransfers([nextTask, ...current.filter((item) => item.taskId !== task.taskId)]);
    const sampledAt = Date.now();
    const previousRate = state.rates[task.taskId];
    const previousTransferred = previousRate?.transferred ?? existing?.transferred ?? task.transferred;
    const elapsed = sampledAt - (previousRate?.sampledAt ?? sampledAt);
    const delta = task.transferred - previousTransferred;
    const rates = { ...state.rates };
    if (task.state === "running") {
      rates[task.taskId] = {
        speedBps: delta > 0 && elapsed > 0 ? delta * 1000 / elapsed : previousRate?.speedBps ?? 0,
        sampledAt,
        transferred: task.transferred,
      };
    } else {
      delete rates[task.taskId];
    }
    return { bySession: groupTransfers(next), rates };
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

export function currentTransferSpeed(sample: TransferRateSample | undefined, now = Date.now()) {
  if (!sample || now - sample.sampledAt > TRANSFER_SPEED_STALE_MS) return 0;
  return Math.max(0, sample.speedBps);
}
