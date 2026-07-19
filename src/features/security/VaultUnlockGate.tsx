import { useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import type { VaultStatus } from "../../types";
import { VaultPasswordDialog } from "./VaultPasswordDialog";

export function VaultUnlockGate() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.vaultStatus().then((next) => {
      if (active) setStatus(next);
    });
    return () => { active = false; };
  }, []);

  const unlock = async (password: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.unlockMasterVault(password);
      setStatus((current) => current ? { ...current, unlocked: true } : current);
    } catch {
      setError("主密码错误，请重新输入");
    } finally {
      setBusy(false);
    }
  };

  return (
    <VaultPasswordDialog
      open={status?.mode === "master_password" && !status.unlocked}
      title="解锁凭据保险库"
      mode="unlock"
      busy={busy}
      error={error}
      onSubmit={(password) => void unlock(password)}
    />
  );
}
