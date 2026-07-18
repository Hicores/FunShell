import { useEffect, useState } from "react";
import { Modal } from "../../components/common/Modal";
import type { RemoteFileEntry } from "../../types";

interface PermissionDialogProps {
  file: RemoteFileEntry | null;
  saving: boolean;
  onClose: () => void;
  onSave: (mode: number, owner: string, group: string) => void;
}

const permissionGroups = [
  { label: "所有者", permissions: [{ label: "读取", bit: 0o400 }, { label: "写入", bit: 0o200 }, { label: "执行", bit: 0o100 }] },
  { label: "组", permissions: [{ label: "读取", bit: 0o040 }, { label: "写入", bit: 0o020 }, { label: "执行", bit: 0o010 }] },
  { label: "其他", permissions: [{ label: "读取", bit: 0o004 }, { label: "写入", bit: 0o002 }, { label: "执行", bit: 0o001 }] },
];

const extendedPermissions = [
  { label: "设置用户 ID", shortName: "setuid", bit: 0o4000 },
  { label: "设置组 ID", shortName: "setgid", bit: 0o2000 },
  { label: "粘滞位", shortName: "sticky", bit: 0o1000 },
];

export function updatePermissionBit(mode: number, bit: number, enabled: boolean) {
  return enabled ? mode | bit : mode & ~bit;
}

export function formatPermissionMode(mode: number) {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}

export function PermissionDialog({ file, saving, onClose, onSave }: PermissionDialogProps) {
  const [mode, setMode] = useState(0);
  const [owner, setOwner] = useState("");
  const [group, setGroup] = useState("");

  useEffect(() => {
    if (file) {
      setMode((file.permissions ?? 0) & 0o7777);
      setOwner(file.user ?? (file.userId != null ? String(file.userId) : ""));
      setGroup(file.group ?? (file.groupId != null ? String(file.groupId) : ""));
    }
  }, [file]);

  const permissionOption = (label: string, bit: number, detail?: string, accessibleLabel = label) => (
    <label className="permission-option" key={bit}>
      <input
        type="checkbox"
        aria-label={detail ? `${accessibleLabel} (${detail})` : accessibleLabel}
        checked={(mode & bit) !== 0}
        onChange={(event) => setMode((current) => updatePermissionBit(current, bit, event.target.checked))}
      />
      <span>{label}{detail && <small>{detail}</small>}</span>
    </label>
  );

  return (
    <Modal
      open={file != null}
      title="修改文件权限"
      width={520}
      onClose={onClose}
      footer={<><button type="button" onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={saving || !owner.trim() || !group.trim()} onClick={() => onSave(mode, owner.trim(), group.trim())}>{saving ? "保存中..." : "确定"}</button></>}
    >
      <div className="permission-dialog">
        <div className="permission-target">
          <strong>{file?.name}</strong>
          <span title={file?.path}>{file?.path}</span>
          <code>{formatPermissionMode(mode)}</code>
        </div>
        <div className="permission-ownership">
          <label>所有者<span className="permission-identity"><input aria-label="所有者" placeholder="用户名或 UID" value={owner} onChange={(event) => setOwner(event.target.value)} />{file?.userId != null && <small>({file.userId})</small>}</span></label>
          <label>用户组<span className="permission-identity"><input aria-label="用户组" placeholder="组名或 GID" value={group} onChange={(event) => setGroup(event.target.value)} />{file?.groupId != null && <small>({file.groupId})</small>}</span></label>
        </div>
        <div className="permission-groups">
          {permissionGroups.map((group) => (
            <fieldset key={group.label}>
              <legend>{group.label}</legend>
              <div className="permission-options">
                {group.permissions.map((permission) => permissionOption(permission.label, permission.bit, undefined, `${group.label} ${permission.label}`))}
              </div>
            </fieldset>
          ))}
          <fieldset>
            <legend>扩展权限</legend>
            <div className="permission-options extended">
              {extendedPermissions.map((permission) => permissionOption(permission.label, permission.bit, permission.shortName))}
            </div>
          </fieldset>
        </div>
      </div>
    </Modal>
  );
}
