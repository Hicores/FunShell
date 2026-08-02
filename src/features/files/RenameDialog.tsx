import type { KeyboardEvent } from "react";
import { Modal } from "../../components/common/Modal";

export interface RenameDialogState {
  sourcePath: string;
  parentPath: string;
  originalName: string;
  name: string;
  kind: "file" | "directory" | "symlink" | "other";
}

interface RenameDialogProps {
  value: RenameDialogState | null;
  saving: boolean;
  onChange: (value: RenameDialogState) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function RenameDialog({ value, saving, onChange, onClose, onConfirm }: RenameDialogProps) {
  const name = value?.name.trim() ?? "";
  const canConfirm = Boolean(value && name && name !== value.originalName);
  const title = value?.kind === "directory" ? "重命名文件夹" : "重命名文件";
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && canConfirm && !saving) {
      event.preventDefault();
      onConfirm();
    }
  };

  return (
    <Modal
      open={value != null}
      title={title}
      width={460}
      closable={!saving}
      onClose={onClose}
      footer={<>
        <button type="button" disabled={saving} onClick={onClose}>取消</button>
        <button className="primary-button" type="button" disabled={!canConfirm || saving} onClick={onConfirm}>
          {saving ? "正在重命名..." : "确定"}
        </button>
      </>}
    >
      {value && <div className="form-grid">
        <label className="wide">所在目录<input aria-label="所在目录" value={value.parentPath} readOnly /></label>
        <label className="wide">原名称<input aria-label="原名称" value={value.originalName} readOnly /></label>
        <label className="wide">新名称<input aria-label="新名称" autoFocus value={value.name} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onChange({ ...value, name: event.target.value })} onKeyDown={submitOnEnter} /></label>
      </div>}
    </Modal>
  );
}
