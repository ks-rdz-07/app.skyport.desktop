import { ReactNode, useEffect } from "react";
import {
  Activity, Check, ChevronLeft, ChevronRight, Clock, Cloud, Compass, Copy, Database, Download, ExternalLink, File, Folder, Globe,
  HardDrive, Info as InfoIcon, KeyRound, Lock, type LucideIcon, Menu, Monitor, Moon, PenLine, Pencil, Plus, Power, RefreshCw, Search, Settings,
  ShieldCheck, Smartphone, Sun, Trash2, TriangleAlert, Upload, User, X,
} from "lucide-react";

// Interface icons come from Lucide (ISC licence, lucide.dev): one consistent outline set.
const ICONS: Record<string, LucideIcon> = {
  drive: HardDrive, settings: Settings, plus: Plus, folder: Folder, external: ExternalLink, refresh: RefreshCw,
  power: Power, edit: Pencil, trash: Trash2, check: Check, alert: TriangleAlert, upload: Upload, cloud: Cloud,
  chevron: ChevronRight, back: ChevronLeft, close: X, lock: Lock, pencil: PenLine, download: Download,
  database: Database, user: User, info: InfoIcon, shield: ShieldCheck, key: KeyRound, copy: Copy, globe: Globe,
  monitor: Monitor, clock: Clock, compass: Compass, phone: Smartphone, menu: Menu, file: File, sun: Sun,
  moon: Moon, search: Search, activity: Activity,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? InfoIcon;
  return <C size={size} strokeWidth={1.75} aria-hidden="true" />;
}

/** A filled folder in its familiar colour, as File Explorer shows it. */
export function FolderGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg className="folder-glyph" width={size} height={size} viewBox="0 0 24 24" strokeWidth={1.4} stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/** A small "i" that explains the thing beside it, through the shared tooltip. */
export function Info({ text }: { text: string }) {
  return <span className="info" tabIndex={0} role="img" aria-label={text} data-tip={text}><Icon name="info" size={13} /></span>;
}

/** The SkyPort wordmark: "Sky" in the brand blue, "Port" in ink, and the logo's mint status light. */
export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} aria-label="SkyPort">
      <span className="wm-sky" aria-hidden="true">Sky</span><span className="wm-port" aria-hidden="true">Port</span><i className="wm-dot" aria-hidden="true" />
    </span>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B6CF6" />
          <stop offset="1" stopColor="#1E3FA8" />
        </linearGradient>
      </defs>
      <rect x="24" y="24" width="464" height="464" rx="112" fill="url(#lg)" />
      <path d="M168 250a72 72 0 0 1 138-30 58 58 0 0 1 66 57 50 50 0 0 1-50 50H190a56 56 0 0 1-22-77z" fill="#fff" opacity=".95" />
      <rect x="140" y="340" width="232" height="56" rx="18" fill="#fff" opacity=".28" />
      <circle cx="336" cy="368" r="11" fill="#7CF0C5" />
    </svg>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Working" />;
}

export function Modal({ title, onClose, children, footer, width = 560 }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export type ConfirmRequest = { title: string; body: ReactNode; confirm: string; danger?: boolean; onConfirm: () => void };

export function Confirm({ req, onClose }: { req: ConfirmRequest; onClose: () => void }) {
  return (
    <Modal
      title={req.title}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${req.danger ? "btn-danger" : "btn-primary"}`} autoFocus onClick={() => { onClose(); req.onConfirm(); }}>
            {req.confirm}
          </button>
        </>
      }
    >
      <div className="confirm-body">{req.body}</div>
    </Modal>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}
