import { FileKey, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Modal } from "../../components/common/Modal";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";

export function KeyManager() {
  const open = useAppStore((state) => state.keyManagerOpen);
  const setOpen = useAppStore((state) => state.openKeyManager);
  const keys = useAppStore((state) => state.keys);
  const refresh = useAppStore((state) => state.refreshConnections);
  const notify = useAppStore((state) => state.notify);
  const [importOpen, setImportOpen] = useState(false);
  const [name, setName] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const generate = async (algorithm: string) => {
    const keyName = window.prompt("私钥名称", `${algorithm.toUpperCase()}-${new Date().toISOString().slice(0, 10)}`);
    if (!keyName) return;
    try { await api.generateKey(keyName, algorithm); await refresh(); }
    catch (error) { notify(String(error)); }
  };

  const importKey = async () => {
    try { await api.importKey(name, privateKey, passphrase || undefined); setImportOpen(false); setName(""); setPrivateKey(""); setPassphrase(""); await refresh(); }
    catch (error) { notify(String(error)); }
  };

  return (
    <>
      <Modal open={open} title="私钥管理" width={760} onClose={() => setOpen(false)} footer={<button type="button" onClick={() => setOpen(false)}>关闭</button>}>
        <div className="key-toolbar"><button type="button" onClick={() => setImportOpen(true)}><Plus size={15} />导入私钥</button><button type="button" onClick={() => void generate("ed25519")}><KeyRound size={15} />生成 Ed25519</button><button type="button" onClick={() => void generate("rsa")}><FileKey size={15} />生成 RSA 4096</button></div>
        <table className="data-table key-table"><thead><tr><th>名称</th><th>类型</th><th>指纹</th><th>公钥</th><th>操作</th></tr></thead><tbody>{keys.map((key) => <tr key={key.id}><td><KeyRound size={15} />{key.name}</td><td>{key.algorithm}</td><td><code>{key.fingerprint}</code></td><td><button type="button" onClick={() => void navigator.clipboard.writeText(key.publicKey)}>复制公钥</button></td><td><button type="button" title="删除" onClick={async () => { if (!window.confirm(`删除私钥 ${key.name}？`)) return; await api.deleteKey(key.id); await refresh(); }}><Trash2 size={15} /></button></td></tr>)}</tbody></table>
        {!keys.length && <div className="empty-state large">尚未导入私钥</div>}
      </Modal>
      <Modal open={importOpen} title="导入私钥" width={680} onClose={() => setImportOpen(false)} footer={<><button type="button" onClick={() => setImportOpen(false)}>取消</button><button className="primary-button" type="button" disabled={!name.trim() || !privateKey.trim()} onClick={() => void importKey()}>导入</button></>}>
        <div className="form-grid key-import-form"><label className="wide">名称<input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="wide">私钥内容<textarea placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} /></label><label className="wide">私钥口令（可选）<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label></div>
      </Modal>
    </>
  );
}
