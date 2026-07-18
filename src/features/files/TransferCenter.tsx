import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { IconButton } from "../../components/common/IconButton";
import { api, isTauri } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";
import type { TransferProgressEvent } from "../../types";
import { TransferPanel } from "./TransferPanel";
import { useTransferStore } from "./transferStore";

export function TransferCenter() {
  const notify = useAppStore((state) => state.notify);
  const bySession = useTransferStore((state) => state.bySession);
  const clearCompleted = useTransferStore((state) => state.clearCompleted);
  const [open, setOpen] = useState(false);
  const transfers = useMemo(() => Object.values(bySession).flat().sort((left, right) => right.taskId.localeCompare(left.taskId)), [bySession]);

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

  return (
    <div className="transfer-center">
      <IconButton label="传输记录" className="transfer-toggle" active={open} onClick={() => setOpen((value) => !value)}><ListChecks size={18} />{transfers.length > 0 && <span>{transfers.length > 99 ? "99+" : transfers.length}</span>}</IconButton>
      {open && <TransferPanel transfers={transfers} onCancel={(taskId) => void api.cancelTransfer(taskId)} onRetry={(task) => void retry(task)} onReveal={(task) => void reveal(task)} onClear={() => Object.keys(bySession).forEach((sessionId) => clearCompleted(sessionId))} onClose={() => setOpen(false)} />}
    </div>
  );
}
