import { ArrowDownToLine, ArrowUpToLine, Ban, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { ContextMenu } from "../../components/common/ContextMenu";
import { IconButton } from "../../components/common/IconButton";
import { formatBytes, formatRate } from "../../lib/format";
import type { TransferProgressEvent } from "../../types";
import { currentTransferSpeed, type TransferRateSample } from "./transferStore";

interface TransferPanelProps {
  transfers: TransferProgressEvent[];
  onCancel: (taskId: string) => void;
  onRetry: (task: TransferProgressEvent) => void;
  onReveal: (task: TransferProgressEvent) => void;
  onClear: () => void;
  onClose: () => void;
  rates?: Record<string, TransferRateSample>;
  now?: number;
}

function taskName(task: TransferProgressEvent) {
  const path = task.direction === "upload" ? task.destination : task.source;
  return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

function statusText(task: TransferProgressEvent) {
  if (task.state === "completed") return "完成";
  if (task.state === "canceled") return "已取消";
  if (task.state === "error") return "失败";
  return task.total > 0 ? `${Math.min(100, Math.round(task.transferred / task.total * 100))}%` : "进行中";
}

export function TransferPanel({ transfers, onCancel, onRetry, onReveal, onClear, onClose, rates = {}, now = Date.now() }: TransferPanelProps) {
  const [context, setContext] = useState<{ x: number; y: number; task: TransferProgressEvent } | null>(null);
  const running = transfers.filter((task) => task.state === "running").length;
  const hasHistory = transfers.some((task) => task.state !== "running");
  return (
    <section className="transfer-panel" role="region" aria-label="传输进度与历史">
      <header>
        <div><strong>传输进度与历史</strong><span>{running ? `${running} 个任务进行中` : `${transfers.length} 条记录`}</span></div>
        <IconButton label="清除已完成记录" disabled={!hasHistory} onClick={onClear}><Trash2 size={14} /></IconButton>
        <IconButton label="关闭传输记录" onClick={onClose}><X size={15} /></IconButton>
      </header>
      <div className="transfer-list">
        {!transfers.length && <div className="empty-state">暂无传输记录</div>}
        {transfers.map((task) => (
          <div
            key={task.taskId}
            className={`transfer-task ${task.state}`}
            onContextMenu={task.direction === "download" ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              setContext({ x: event.clientX, y: event.clientY, task });
            } : undefined}
          >
            <span className="transfer-direction">{task.direction === "upload" ? <ArrowUpToLine size={14} /> : <ArrowDownToLine size={14} />}{task.direction === "upload" ? "上传" : "下载"}</span>
            <div className="transfer-file"><strong>{taskName(task)}</strong><span title={`${task.source} -> ${task.destination}`}>{task.source} → {task.destination}</span></div>
            <div className="transfer-progress"><progress max={Math.max(task.total, 1)} value={task.transferred} /><span>{formatBytes(task.transferred)} / {formatBytes(task.total)}</span>{task.state === "running" && <span>速度 {formatRate(currentTransferSpeed(rates[task.taskId], now))}</span>}</div>
            <em>{statusText(task)}</em>
            {task.state === "running" ? <IconButton label="取消传输" onClick={() => onCancel(task.taskId)}><Ban size={14} /></IconButton> : task.state === "error" || task.state === "canceled" ? <IconButton label="重试传输" onClick={() => onRetry(task)}><RotateCcw size={14} /></IconButton> : <span />}
          </div>
        ))}
      </div>
      {context && (
        <ContextMenu x={context.x} y={context.y} onClose={() => setContext(null)}>
          <button type="button" onClick={() => onReveal(context.task)}>打开所在文件夹</button>
        </ContextMenu>
      )}
    </section>
  );
}
