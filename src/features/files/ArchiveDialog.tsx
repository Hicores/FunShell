import type { KeyboardEvent } from "react";
import { Modal } from "../../components/common/Modal";

export type ArchiveDialogState =
  | {
      kind: "create";
      sourcePath: string;
      destinationDirectory: string;
      archiveName: string;
    }
  | {
      kind: "extract";
      archivePath: string;
      destinationPath: string;
    };

interface ArchiveDialogProps {
  value: ArchiveDialogState | null;
  running: boolean;
  onChange: (value: ArchiveDialogState) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function ArchiveDialog({ value, running, onChange, onClose, onConfirm }: ArchiveDialogProps) {
  const creating = value?.kind === "create";
  const canConfirm = value != null && (creating ? value.archiveName.trim() !== "" : value.destinationPath.trim() !== "");
  const title = creating ? "打包为 tar.gz" : "解包 tar.gz";

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && canConfirm && !running) {
      event.preventDefault();
      onConfirm();
    }
  };

  return (
    <Modal
      open={value != null}
      title={title}
      width={500}
      closable={!running}
      onClose={onClose}
      footer={(
        <>
          <button type="button" disabled={running} onClick={onClose}>取消</button>
          <button className="primary-button" type="button" disabled={!canConfirm || running} onClick={onConfirm}>
            {running ? (creating ? "正在打包..." : "正在解包...") : (creating ? "开始打包" : "开始解包")}
          </button>
        </>
      )}
    >
      {value?.kind === "create" && (
        <div className="form-grid">
          <label className="wide">打包对象<input aria-label="打包对象" value={value.sourcePath} readOnly /></label>
          <label className="wide">压缩包保存目录<input aria-label="压缩包保存目录" value={value.destinationDirectory} readOnly /></label>
          <label className="wide">压缩包名称<input aria-label="压缩包名称" autoFocus value={value.archiveName} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onChange({ ...value, archiveName: event.target.value })} onKeyDown={submitOnEnter} /></label>
        </div>
      )}
      {value?.kind === "extract" && (
        <div className="form-grid">
          <label className="wide">待解包文件<input aria-label="待解包文件" value={value.archivePath} readOnly /></label>
          <label className="wide">解包路径<input aria-label="解包路径" autoFocus value={value.destinationPath} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onChange({ ...value, destinationPath: event.target.value })} onKeyDown={submitOnEnter} /></label>
        </div>
      )}
    </Modal>
  );
}
