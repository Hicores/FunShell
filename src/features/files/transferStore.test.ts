import { beforeEach, describe, expect, it } from "vitest";
import type { TransferProgressEvent } from "../../types";
import { unreadTransferCount, useTransferStore } from "./transferStore";

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
});
