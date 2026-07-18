import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./IconButton";

interface ModalProps {
  open: boolean;
  title: string;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

export function Modal({ open, title, width = 760, children, footer, onClose }: ModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <section
        className="modal-window"
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-titlebar">
          <strong>{title}</strong>
          <IconButton label="关闭" onClick={onClose}><X size={17} /></IconButton>
        </header>
        <div className="modal-content">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}
