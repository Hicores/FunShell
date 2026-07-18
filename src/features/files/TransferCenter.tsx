import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ListChecks } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../../components/common/IconButton";
import { api, isTauri } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { TransferProgressEvent } from "../../types";
import { TransferPanel } from "./TransferPanel";
import { unreadTransferCount, useTransferStore } from "./transferStore";

export function TransferCenter() {
  const notify = useAppStore((state) => state.notify);
  const bySession = useTransferStore((state) => state.bySession);
  const unreadCount = useTransferStore(unreadTransferCount);
  const clearCompleted = useTransferStore((state) => state.clearCompleted);
  const markViewed = useTransferStore((state) => state.markViewed);
  const setViewing = useTransferStore((state) => state.setViewing);
  const [open, setOpen] = useState(false);
  const centerRef = useRef<HTMLDivElement>(null);
  const transfers = useMemo(() => Object.values(bySession).flat().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [bySession]);

  const retry = async (task: TransferProgressEvent) => {
    try {
      if (task.direction === "upload") await api.uploadRemoteFile(task.sessionId, task.source, task.destination);
      else await api.downloadRemoteFile(task.sessionId, task.source, task.destination);
    } catch (error) { notify(String(error)); }
  };

  const reveal = async (task: TransferProgressEvent) => {
    if (!isTauri()) {
      notify(`演示模式：打开 ${task.destination} 所在文件夹`);
      return;
    }
    try {
      await revealItemInDir(task.destination);
    } catch (error) {
      notify(String(error));
    }
  };

  const toggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    setViewing(nextOpen);
    if (!nextOpen) return;
    markViewed();
    void api.markTransferHistoryViewed().catch((error) => notify(String(error)));
  };

  const close = () => {
    setOpen(false);
    setViewing(false);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !centerRef.current?.contains(target)) close();
    };
    const closeOnWindowBlur = () => close();
    document.addEventListener("click", closeOnOutsideClick);
    window.addEventListener("blur", closeOnWindowBlur);
    return () => {
      document.removeEventListener("click", closeOnOutsideClick);
      window.removeEventListener("blur", closeOnWindowBlur);
    };
  }, [open]);

  const clear = async () => {
    try {
      await api.clearTransferHistory();
      clearCompleted();
    } catch (error) {
      notify(String(error));
    }
  };

  return (
    <div ref={centerRef} className="transfer-center">
      <IconButton label="传输记录" className="transfer-toggle" active={open} onClick={toggle}><ListChecks size={18} />{unreadCount > 0 && <span>{unreadCount > 99 ? "99+" : unreadCount}</span>}</IconButton>
      {open && <TransferPanel transfers={transfers} onCancel={(taskId) => void api.cancelTransfer(taskId)} onRetry={(task) => void retry(task)} onReveal={(task) => void reveal(task)} onClear={() => void clear()} onClose={close} />}
    </div>
  );
}
