import { useEffect, useState } from "react";
import { Details, DriveStatus, Snapshot, api, formatBytes, plural, timeAgo, OS, tag, driveName } from "@/api";
import { Capacity, stateLabel } from "@/components/DriveCard";
import { Icon, Info, Spinner } from "@/components/ui";

type Props = { id: string; status?: DriveStatus; onBack: () => void; onOpen: () => void; onConnect: () => void; onDisconnect: () => void; onFiles: () => void };

export function DetailsPage({ id, status, onBack, onOpen, onConnect, onDisconnect, onFiles }: Props) {
  const [d, setD] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    setError("");
    try { setD(await api.details(id)); } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  const crumbs = (name: string) => (
    <nav className="crumbs-top" aria-label="Breadcrumb"><button onClick={onBack}>Drives</button><Icon name="chevron" size={12} /><span>{name}</span></nav>
  );

  if (!d) {
    return (
      <div className="page">
        {crumbs("Details")}
        {error ? <div className="inline-alert danger"><Icon name="alert" size={16} /><span>{error}</span></div> : <div className="loading-row"><Spinner />Gathering drive details…</div>}
      </div>
    );
  }

  const q = d.quota;
  const state = status?.state ?? "stopped";
  const pending = (status?.uploading ?? 0) + (status?.queued ?? 0);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const region = new Intl.DisplayNames(undefined, { type: "region" }).of(navigator.language.split("-")[1] ?? "US") ?? navigator.language;
  const uploads = pending ? `uploading ${plural(pending, "file")}` : d.waiting ? `${plural(d.waiting, "file")} waiting to upload` : "everything uploaded";
  const name = driveName(d.profile);

  return (
    <div className="page">
      {crumbs(name)}
      <header className="title-row">
        <div>
          <h1>{name}</h1>
          <p className="finding">{stateLabel[state]} · {uploads} · {d.account.name}, {d.profile.path ? `/${d.profile.path}` : "entire OneDrive"}</p>
        </div>
        <div className="title-actions">
          <button className="btn btn-ghost" onClick={load} disabled={loading} aria-label="Refresh">{loading ? <Spinner /> : <Icon name="refresh" size={16} />}</button>
          <button className="btn" onClick={onFiles}><Icon name="folder" size={16} />Browse files</button>
          {state === "connected" ? (
            <>
              <button className="btn" onClick={onDisconnect}><Icon name="power" size={16} />Disconnect</button>
              <button className="btn btn-primary" onClick={onOpen}><Icon name="external" size={16} />Open in Explorer</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={onConnect}><Icon name="power" size={16} />Connect</button>
          )}
        </div>
      </header>

      <div className="grid12">
        <section className="panel span-8">
          <div className="panel-head"><h2>OneDrive storage</h2><span className="aside">{q ? `${d.account.name} · updated ${timeAgo(q.at)}` : ""}</span></div>
          {q && q.total ? (
            <>
              <div className="answer"><strong>{formatBytes(q.used)}</strong><span className="num">used of {formatBytes(q.total)} ({(((q.used ?? 0) / q.total) * 100).toFixed(1)}%)</span></div>
              <Capacity q={q} />
              <dl className="figures">
                <div><dt>Available</dt><dd className="num">{formatBytes(q.free)}</dd></div>
                <div><dt>In the recycle bin<Info text="Deleted files still count toward your storage until the OneDrive recycle bin is emptied." /></dt><dd className="num">{formatBytes(q.trashed)}</dd></div>
                <div><dt>Cached on this PC<Info text="Space this account uses in the local cache. Files you have not opened are not stored here." /></dt><dd className="num">{formatBytes(d.cacheBytes)}</dd></div>
              </dl>
              <History points={d.history} />
            </>
          ) : (
            <p className="empty-note">{d.quotaError ?? "This account doesn't report its storage."}</p>
          )}
        </section>

        <div className="stack span-4">
        <section className="panel">
          <div className="panel-head"><h2>This drive</h2></div>
          <dl className="list">
            <div><dt>Status</dt><dd><span className={`pill pill-${state}`}><i className="dot" />{stateLabel[state]}</span></dd></div>
            <div><dt>{OS === "windows" ? "Drive letter" : "Folder"}</dt><dd>{tag(d.profile)}</dd></div>
            <div><dt>Folder</dt><dd title={d.profile.path}>{d.profile.path ? `/${d.profile.path}` : "Entire OneDrive"}</dd></div>
            <div><dt>Access</dt><dd>{d.profile.readOnly ? "Read only" : "Read & write"}</dd></div>
            <div><dt>Uploads</dt><dd className="num">{pending ? `${plural(pending, "file")} in progress` : d.waiting ? `${plural(d.waiting, "file")} waiting` : "Up to date"}</dd></div>
          </dl>
        </section>
          <section className="panel">
            <div className="panel-head"><h2>Account</h2></div>
            <dl className="list">
              <div><dt>Name</dt><dd>{d.account.name}</dd></div>
              <div><dt>Type</dt><dd>{d.account.kind}</dd></div>
              <div><dt>Drives on this account</dt><dd>{d.account.drives.join(", ")}</dd></div>
            </dl>
          </section>
        </div>

        <section className="panel span-7">
          <div className="panel-head"><h2>Recent activity</h2><span className="aside"><Icon name="shield" size={12} /> Kept encrypted on this PC</span></div>
          {d.events.length === 0 ? <p className="empty-note">No activity yet. Connecting the drive starts the record.</p> : (
            <ul className="timeline">
              {d.events.slice(0, 6).map((e, i) => (
                <li key={i} className={`ev-${e.kind}`}>
                  <i />
                  <span>{e.detail}</span>
                  <time title={new Date(e.at * 1000).toLocaleString()}>{timeAgo(e.at)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel span-5">
          <div className="panel-head"><h2>This PC</h2></div>
          <dl className="list">
            <div><dt>Computer and user</dt><dd>{d.pc.computer || "—"} · {d.pc.user || "—"}</dd></div>
            <div><dt>Local IP address</dt><dd className="num">{d.pc.localIp ?? "Offline"}</dd></div>
            <div><dt>Time zone and region</dt><dd>{tz} · {region}</dd></div>
            <div><dt>Cache folder</dt><dd className="mono" title="Only your Windows account can open it">{d.cacheDir}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}

/** Used storage over time on a real scale: round ticks above the maximum, 4 faint gridlines. */
function History({ points }: { points: Snapshot[] }) {
  const pts = points.filter((p) => p.used != null);
  if (pts.length < 2) return <p className="muted small">Storage history builds up as you use SkyPort: one reading every 10 minutes while it's open.</p>;
  const G = 1024 ** 3;
  const maxGb = Math.max(...pts.map((p) => p.used! / G));
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((s) => s * 4 > maxGb) ?? 1000;
  const top = step * 4;
  const W = 640, H = 200, L = 52, B = 22, T = 6;
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - 4);
  const y = (gb: number) => T + (1 - gb / top) * (H - T - B);
  const fmtDate = (at: number) => new Date(at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const xi = [0, Math.round((pts.length - 1) / 3), Math.round(((pts.length - 1) * 2) / 3), pts.length - 1];
  return (
    <div className="history">
      <div className="panel-head"><h3>Used storage, last {pts.length} days</h3></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Used storage over the last ${pts.length} days, from ${formatBytes(pts[0].used)} to ${formatBytes(pts[pts.length - 1].used)}`}>
        {[0, 1, 2, 3, 4].map((k) => (
          <g key={k}>
            <line className="gridline" x1={L} x2={W} y1={y(k * step)} y2={y(k * step)} />
            <text className="tick" x={L - 8} y={y(k * step) + 4} textAnchor="end">{k * step} GB</text>
          </g>
        ))}
        <polyline className="line" points={pts.map((p, i) => `${x(i)},${y(p.used! / G)}`).join(" ")} />
        {xi.map((i, k) => (
          <text key={i} className="tick" x={x(i)} y={H - 4} textAnchor={k === 0 ? "start" : k === xi.length - 1 ? "end" : "middle"}>{k === xi.length - 1 ? "Today" : fmtDate(pts[i].at)}</text>
        ))}
      </svg>
    </div>
  );
}
