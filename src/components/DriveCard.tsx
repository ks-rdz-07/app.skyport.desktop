import { DriveStatus, Profile, Snapshot, formatBytes, plural, tag, driveName } from "@/api";
import { Icon, Spinner } from "@/components/ui";

type Props = {
  profile: Profile;
  account: string;
  status?: DriveStatus;
  quota?: Snapshot | "error";
  waiting: number;
  busy?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onOpen: () => void;
  onDetails: () => void;
  onFiles: () => void;
  onEdit: () => void;
  onRemove: () => void;
};

export const stateLabel = { stopped: "Not connected", starting: "Connecting…", connected: "Connected", error: "Needs attention" } as const;

/** The capacity bar This PC draws under a drive: the one data hue, the true ratio. */
export function Capacity({ q }: { q?: Snapshot | "error" | null }) {
  if (!q || q === "error" || !q.total) return <div className="capacity none" aria-hidden="true"><i /></div>;
  const pct = (q.used ?? 0) / q.total;
  return (
    <div className={`capacity ${pct > 0.9 ? "full" : ""}`} role="progressbar" aria-label="Storage used" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

export const freeLine = (q?: Snapshot | "error" | null) =>
  q === "error" ? "Storage not reported" : q?.total ? `${formatBytes(q.free)} free of ${formatBytes(q.total)}` : "Checking storage…";

/** One drive, drawn the way This PC draws it, with its uploads, state and actions in one row. */
export function DriveCard({ profile: p, account, status, quota, waiting, busy, onConnect, onDisconnect, onReconnect, onOpen, onDetails, onFiles, onEdit, onRemove }: Props) {
  const state = busy === "connecting" ? "starting" : status?.state ?? "stopped";
  const live = state === "connected" || state === "starting";
  const pending = (status?.uploading ?? 0) + (status?.queued ?? 0);

  return (
    <div className={`drive-row state-${state}`} data-tour="drive-card">
      <div className="drive-id">
        <span className="drive-glyph"><Icon name="drive" size={18} /></span>
        <button className="drive-name" onClick={onDetails} title="Drive details">{driveName(p)}</button>
        <Capacity q={quota} />
        <span className="drive-free num">{freeLine(quota)}</span>
      </div>

      <div className="cell">
        <strong>{account}</strong>
        <span>{p.path ? `/${p.path}` : "Entire OneDrive"} · {p.readOnly ? "Read only" : "Read & write"}</span>
      </div>

      <div className="cell cell-uploads">
        {live && pending > 0 ? (
          <><strong className="warn">Uploading {plural(pending, "file")}</strong><span>Keep the drive connected to finish</span></>
        ) : live && (status?.failed ?? 0) > 0 ? (
          <><strong className="warn">{plural(status!.failed, "upload")} retrying</strong><span>Retries on its own</span></>
        ) : !live && waiting > 0 ? (
          <><strong className="warn">{plural(waiting, "file")} waiting</strong><span>Upload when you connect</span></>
        ) : (
          <><strong>{state === "connected" ? "Everything uploaded" : "Nothing waiting"}</strong><span>{state === "connected" ? `At ${tag(p)}` : "Hidden from File Explorer"}</span></>
        )}
      </div>

      <div className="row-actions">
        <span className={`pill pill-${state}`}>
          {state === "starting" ? <Spinner size={10} /> : <i className="dot" />}
          {busy === "disconnecting" ? "Disconnecting…" : stateLabel[state]}
        </span>
        {state === "connected" ? (
          <button className="btn btn-sm" onClick={onOpen}><Icon name="external" size={15} />Open</button>
        ) : (
          <button className="btn btn-sm" onClick={state === "error" ? onReconnect : onConnect} disabled={!!busy}>
            {busy ? <Spinner size={13} /> : <Icon name="power" size={15} />}{state === "error" ? "Reconnect" : "Connect"}
          </button>
        )}
        <button className="icon-btn" onClick={onFiles} title="Browse files" aria-label={`Browse files in ${p.label}`}><Icon name="folder" size={16} /></button>
        {live && (
          <button className="icon-btn" onClick={onDisconnect} disabled={!!busy} title="Disconnect" aria-label={`Disconnect ${p.label}`}><Icon name="power" size={16} /></button>
        )}
        <button className="icon-btn" onClick={onEdit} disabled={live || !!busy} title={live ? "Disconnect to edit" : "Edit"} aria-label={`Edit ${p.label}`}><Icon name="edit" size={16} /></button>
        <button className="icon-btn" onClick={onRemove} disabled={live || !!busy} title={live ? "Disconnect to remove" : "Remove"} aria-label={`Remove ${p.label}`}><Icon name="trash" size={16} /></button>
        <button className="icon-btn" onClick={onDetails} title="Details" aria-label={`${p.label} details`} data-tour="details"><Icon name="chevron" size={16} /></button>
      </div>

      {state === "error" && status?.error && (
        <div className="row-error"><Icon name="alert" size={15} /><span>{status.error}</span></div>
      )}
    </div>
  );
}
