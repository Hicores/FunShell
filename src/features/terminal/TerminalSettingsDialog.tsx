import { Modal } from "../../components/common/Modal";

export const DEFAULT_TERMINAL_FONT_FAMILY = '"Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace';

export const TERMINAL_FONT_OPTIONS = [
  '"Cascadia Mono", Consolas, monospace',
  '"Cascadia Code", Consolas, monospace',
  'Consolas, monospace',
  '"JetBrains Mono", Consolas, monospace',
  '"Source Code Pro", Consolas, monospace',
  '"Microsoft YaHei UI", sans-serif',
  "monospace",
];

interface TerminalSettingsDialogProps {
  open: boolean;
  fontFamily: string;
  fontSize: number;
  saving: boolean;
  onFontFamilyChange: (value: string) => void;
  onFontSizeChange: (value: number) => void;
  onClose: () => void;
  onSave: () => void;
}

export function TerminalSettingsDialog({ open, fontFamily, fontSize, saving, onFontFamilyChange, onFontSizeChange, onClose, onSave }: TerminalSettingsDialogProps) {
  return (
    <Modal
      open={open}
      title="终端设置"
      width={480}
      onClose={onClose}
      footer={<><button type="button" onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={onSave}>保存</button></>}
    >
      <div className="form-grid terminal-settings-form">
        <label className="wide">终端字体
          <input list="terminal-font-options" value={fontFamily} onChange={(event) => onFontFamilyChange(event.target.value)} />
          <datalist id="terminal-font-options">{TERMINAL_FONT_OPTIONS.map((option) => <option key={option} value={option} />)}</datalist>
        </label>
        <label>字体大小（px）
          <input type="number" min={9} max={32} step={1} value={fontSize} onChange={(event) => onFontSizeChange(Number(event.target.value))} />
        </label>
      </div>
    </Modal>
  );
}
