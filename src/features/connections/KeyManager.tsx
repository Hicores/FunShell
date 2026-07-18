import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FileKey, FolderOpen, KeyRound, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Modal } from "../../components/common/Modal";
import { api, isTauri } from "../../lib/ipc";
import { useAppStore } from "../../stores/appStore";

function keyNameFromPath(path: string) {
  const filename = path.split(/[\\/]/).at(-1) ?? "";
  return filename.replace(/\.(pem|key|ppk)$/i, "") || filename;
}

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
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const browserFileRef = useRef<HTMLInputElement>(null);

  const generate = async (algorithm: string) => {
    const keyName = window.prompt("私钥名称", `${algorithm.toUpperCase()}-${new Date().toISOString().slice(0, 10)}`);
    if (!keyName) return;
    try { await api.generateKey(keyName, algorithm); await refresh(); }
    catch (error) { notify(String(error)); }
  };

  const importKey = async () => {
    try {
      if (selectedFilePath && isTauri()) await api.importKeyFile(name, selectedFilePath, passphrase || undefined);
      else await api.importKey(name, privateKey, passphrase || undefined);
      closeImport();
      await refresh();
    }
    catch (error) { notify(String(error)); }
  };

  const closeImport = () => {
    setImportOpen(false);
    setName("");
    setPrivateKey("");
    setPassphrase("");
    setSelectedFilePath("");
    if (browserFileRef.current) browserFileRef.current.value = "";
  };

  const choosePrivateKeyFile = async () => {
    if (!isTauri()) {
      browserFileRef.current?.click();
      return;
    }
    try {
      const path = await openDialog({ title: "选择私钥文件", multiple: false, directory: false });
      if (typeof path !== "string") return;
      setSelectedFilePath(path);
      setPrivateKey("");
      setName((current) => current || keyNameFromPath(path));
    } catch (error) {
      notify(String(error));
    }
  };

  const loadBrowserFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const content = await file.text();
      setPrivateKey(content);
      setSelectedFilePath(file.name);
      setName((current) => current || keyNameFromPath(file.name));
    } catch (error) {
      notify(String(error));
    }
  };

  return (
    <>
      <Modal open={open} title="私钥管理" width={760} onClose={() => setOpen(false)} footer={<button type="button" onClick={() => setOpen(false)}>关闭</button>}>
        <div className="key-toolbar"><button type="button" onClick={() => setImportOpen(true)}><Plus size={15} />导入私钥</button><button type="button" onClick={() => void generate("ed25519")}><KeyRound size={15} />生成 Ed25519</button><button type="button" onClick={() => void generate("rsa")}><FileKey size={15} />生成 RSA 4096</button></div>
        <table className="data-table key-table"><thead><tr><th>名称</th><th>类型</th><th>指纹</th><th>公钥</th><th>操作</th></tr></thead><tbody>{keys.map((key) => <tr key={key.id}><td><KeyRound size={15} />{key.name}</td><td>{key.algorithm}</td><td><code>{key.fingerprint}</code></td><td><button type="button" onClick={() => void navigator.clipboard.writeText(key.publicKey)}>复制公钥</button></td><td><button type="button" title="删除" onClick={async () => { if (!window.confirm(`删除私钥 ${key.name}？`)) return; await api.deleteKey(key.id); await refresh(); }}><Trash2 size={15} /></button></td></tr>)}</tbody></table>
        {!keys.length && <div className="empty-state large">尚未导入私钥</div>}
      </Modal>
      <Modal open={importOpen} title="导入私钥" width={680} onClose={closeImport} footer={<><button type="button" onClick={closeImport}>取消</button><button className="primary-button" type="button" disabled={!name.trim() || (!privateKey.trim() && !selectedFilePath)} onClick={() => void importKey()}>导入</button></>}>
        <div className="form-grid key-import-form">
          <label className="wide">名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <div className="wide key-file-picker">
            <button type="button" onClick={() => void choosePrivateKeyFile()}><FolderOpen size={15} />选择本地文件</button>
            <span title={selectedFilePath}>{selectedFilePath || "尚未选择文件，可在下方手动粘贴"}</span>
            {selectedFilePath && <button type="button" onClick={() => { setSelectedFilePath(""); setPrivateKey(""); }}>清除</button>}
            <input ref={browserFileRef} className="key-file-input" type="file" onChange={(event) => void loadBrowserFile(event.target.files?.[0])} />
          </div>
          <label className="wide">私钥内容<textarea placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={privateKey} onChange={(event) => { setPrivateKey(event.target.value); setSelectedFilePath(""); }} /></label>
          <label className="wide">私钥口令（可选）<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
        </div>
      </Modal>
    </>
  );
}
