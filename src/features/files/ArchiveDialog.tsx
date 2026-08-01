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
  const isCreate = value?.kind === "create";
  const canConfirm = value != null && (isCreate ? value.archiveName.trim().length > 0 : value.destinationPath.trim().length > 0);
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && canConfirm && !running) {
      event.preventDefault();
      onConfirm();
    }
  };

  return (
    <Modal
      open={value != null}
      title={isCreate ? "打包为 tar.gz" : "解包 tar.gz"}
      width={540}
      closable={!running}
      onClose={onClose}
      footer={<>
        <button type="button" disabled={running} onClick={onClose}>取消</button>
        <button className="primary-button" type="button" disabled={!canConfirm || running} onClick={onConfirm}>
          {running ? (isCreate ? "正在打包..." : "正在解包...") : (isCreate ? "开始打包" : "开始解包")}
        </button>
      </>}
    >
      {value?.kind === "create" ? (
        <div className="form-grid archive-form">
          <label className="wide">打包对象<input aria-label="打包对象" value={value.sourcePath} readOnly /></label>
          <label className="wide">保存目录<input aria-label="压缩包保存目录" value={value.destinationDirectory} readOnly /></label>
          <label className="wide">压缩包名称（可自定义）<input aria-label="压缩包名称" autoFocus value={value.archiveName} onChange={(event) => onChange({ ...value, archiveName: event.target.value })} onKeyDown={submitOnEnter} /></label>
          <span className="field-note">压缩包固定保存在当前目录，名称会自动补充 .tar.gz 后缀。</span>
        </div>
      ) : value?.kind === "extract" ? (
        <div className="form-grid archive-form">
          <label className="wide">压缩包<input aria-label="待解包文件" value={value.archivePath} readOnly /></label>
          <label className="wide">解包到<input aria-label="解包路径" autoFocus value={value.destinationPath} onChange={(event) => onChange({ ...value, destinationPath: event.target.value })} onKeyDown={submitOnEnter} /></label>
          <span className="field-note">默认解包到压缩包所在目录，并还原打包时保存的文件或目录名称及层级。</span>
        </div>
      ) : null}
    </Modal>
  );
}
