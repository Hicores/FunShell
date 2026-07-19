import { useEffect, useState } from "react";
import { Modal } from "../../components/common/Modal";

interface VaultPasswordDialogProps {
  open: boolean;
  title: string;
  mode: "create" | "unlock";
  busy: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
  onClose?: () => void;
}

export function VaultPasswordDialog({ open, title, mode, busy, error, onSubmit, onClose }: VaultPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    setPassword("");
    setConfirmation("");
  }, [mode, open]);

  const validLength = [...password].length >= 9;
  const valid = validLength && (mode === "unlock" || password === confirmation);
  const submit = () => {
    if (valid && !busy) onSubmit(password);
  };

  return (
    <Modal
      open={open}
      title={title}
      width={460}
      closable={onClose != null}
      onClose={onClose ?? (() => undefined)}
      footer={<>{onClose && <button type="button" disabled={busy} onClick={onClose}>取消</button>}<button className="primary-button" type="button" disabled={!valid || busy} onClick={submit}>{busy ? "处理中" : mode === "create" ? "启用" : "解锁"}</button></>}
    >
      <div className="form-grid vault-password-form">
        <label className="wide">主密码（至少 9 个字符）<input autoFocus type="password" autoComplete={mode === "create" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} /></label>
        {mode === "create" && <label className="wide">确认主密码<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} /></label>}
        {mode === "create" && confirmation && password !== confirmation && <p className="form-error wide">两次输入的主密码不一致</p>}
        {error && <p className="form-error wide" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
