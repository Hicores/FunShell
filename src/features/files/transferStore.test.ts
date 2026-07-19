import { beforeEach, describe, expect, it } from "vitest";
import type { TransferProgressEvent } from "../../types";
import { MAX_RUNTIME_TRANSFERS, unreadTransferCount, useTransferStore } from "./transferStore";

const transfer: TransferProgressEvent = {
  sessionId: "session-1",
  taskId: "task-1",
  direction: "download",
  source: "/root/archive.tar",
  destination: "C:\\downloads\\archive.tar",
  transferred: 1024,
  total: 1024,
  state: "completed",
  updatedAt: "2026-07-18T10:00:00Z",
  viewed: false,
};

describe("transferStore", () => {
  beforeEach(() => useTransferStore.setState({ bySession: {}, viewing: false }));

  it("hydrates persisted history and marks it viewed", () => {
    useTransferStore.getState().hydrate([transfer]);
    expect(unreadTransferCount(useTransferStore.getState())).toBe(1);

    useTransferStore.getState().markViewed();
    expect(unreadTransferCount(useTransferStore.getState())).toBe(0);
  });

  it("keeps an existing task viewed across later progress events", () => {
    useTransferStore.getState().hydrate([{ ...transfer, state: "running", viewed: true }]);
    useTransferStore.getState().record({ ...transfer, viewed: false });

    expect(useTransferStore.getState().bySession["session-1"][0].viewed).toBe(true);
    expect(unreadTransferCount(useTransferStore.getState())).toBe(0);
  });

  it("does not mark tasks unread while the transfer panel is open", () => {
    useTransferStore.getState().setViewing(true);
    useTransferStore.getState().record(transfer);

    expect(unreadTransferCount(useTransferStore.getState())).toBe(0);
  });

  it("keeps late startup history viewed when the panel is already open", () => {
    useTransferStore.getState().setViewing(true);
    useTransferStore.getState().hydrate([transfer]);

    expect(unreadTransferCount(useTransferStore.getState())).toBe(0);
  });

  it("limits runtime history globally instead of per session", () => {
    const history = Array.from({ length: MAX_RUNTIME_TRANSFERS }, (_, index) => ({
      ...transfer,
      sessionId: `session-${index}`,
      taskId: `task-${index}`,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }));
    useTransferStore.getState().hydrate(history);
    useTransferStore.getState().record({
      ...transfer,
      sessionId: "session-new",
      taskId: "task-new",
      updatedAt: "2026-07-19T12:00:00Z",
    });

    const transfers = Object.values(useTransferStore.getState().bySession).flat();
    expect(transfers).toHaveLength(MAX_RUNTIME_TRANSFERS);
    expect(transfers.some((task) => task.taskId === "task-new")).toBe(true);
    expect(transfers.some((task) => task.taskId === "task-0")).toBe(false);
  });
});
