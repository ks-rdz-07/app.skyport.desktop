import { useEffect, useState } from "react";
import { DriveActivity, DriveStatus, Profile, api, formatBytes, plural, driveName } from "@/api";
import { Icon, Info } from "@/components/ui";
import { FileIcon } from "@/components/FileIcon";

type Props = { profiles: Profile[]; statuses: Record<string, DriveStatus>; toast: (m: string, tone?: "ok" | "danger") => void };

const speedText = (b: number) => (b > 0 ? `${formatBytes(b)}/s` : "—");
const etaText = (s: number | null) => (s == null ? "—" : s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

/** Parses "2026/11/26 17:01:46 INFO  : message" into its parts; anything else is kept as-is. */
function parseLine(l: string) {
  const m = l.match(/^(\d{4}\/\d{2}\/\d{2}) (\d{2}:\d{2}):\d{2} (\w+)\s*:\s?(.*)$/);
  return m ? { time: m[2], date: m[1], level: m[3], text: m[4] } : { time: "", date: "", level: "", text: l };
}

/** Live transfers, the upload queue and each drive's log. */
export function ActivityPage({ profiles, statuses, toast }: Props) {
  const [act, setAct] = useState<DriveActivity[] | null>(null);
  const [logDrive, setLogDrive] = useState("");
  const [lines, setLines] = useState<string[] | null>(null);
  const name = (id: string) => { const p = profiles.find((x) => x.id === id); return p ? driveName(p) : id; };

  useEffect(() => {
    const load = () => api.activity().then((a) => {
      setAct(a);
      // open the log of the drive that is doing something, else the first connected one
      setLogDrive((cur) => cur || a.find((d) => d.transfers.length || d.queue.length)?.id || profiles.find((p) => statuses[p.id]?.state === "connected")?.id || profiles[0]?.id || "");
    }).catch(() => setAct([]));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!logDrive) return;
    const load = () => api.logs(logDrive).then(setLines).catch(() => setLines([]));
    setLines(null);
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [logDrive]);

  const transfers = (act ?? []).flatMap((a) => a.transfers.map((t) => ({ ...t, drive: a.id })));
  const queue = (act ?? []).flatMap((a) => a.queue.map((q) => ({ ...q, drive: a.id })));
  const speed = (act ?? []).reduce((s, a) => s + a.speed, 0);
  const moved = (act ?? []).reduce((s, a) => s + a.transferred, 0);
  // one source for retries: the queue items that have failed at least once (the strip and the list agree)
  const errors = queue.filter((q) => q.tries > 0).length;
  const waiting = queue.filter((q) => !q.uploading).length;
  const live = profiles.filter((p) => statuses[p.id]?.state === "connected").length;

  const finding = act === null ? "Checking your drives…"
    : transfers.length ? `Uploading ${plural(transfers.length, "file")} at ${speedText(speed)}${waiting ? ` · ${waiting} more waiting` : ""}.`
    : queue.length ? `${plural(queue.length, "file")} waiting to upload. They start a few seconds after you stop editing.`
    : live ? "Nothing is transferring. Every change is uploaded." : "No drive is connected, so nothing can transfer.";

  return (
    <div className="page">
      <header className="title-row">
        <div>
          <h1>Activity</h1>
          <p className={transfers.length || errors ? "finding" : ""}>{finding}</p>
        </div>
        <div className="title-actions">
          <button className="btn" onClick={() => api.openLogs().catch((e) => toast(String(e)))}><Icon name="folder" size={16} />Open log folder</button>
        </div>
      </header>

      <dl className="strip">
        <div><dt>Speed now</dt><dd className="num">{speedText(speed)}</dd><span className="sub">{plural(live, "drive")} connected</span></div>
        <div><dt>Moved this session</dt><dd className="num">{formatBytes(moved)}</dd><span className="sub">since each drive connected</span></div>
        <div><dt>Waiting to upload</dt><dd>{queue.length}<small>{queue.length === 1 ? "file" : "files"}</small></dd><span className="sub">{queue.filter((q) => q.uploading).length} uploading now</span></div>
        <div><dt>Retries<Info text="Uploads that failed, usually because the connection dropped. SkyPort retries them on its own." /></dt><dd className={errors ? "neg" : ""}>{errors}</dd><span className="sub">{errors ? `${plural(errors, "file")} retrying on its own` : "no failed uploads"}</span></div>
      </dl>

      <section className="panel files">
        <div className="files-bar"><h2 className="bar-title">Transferring now</h2><span className="aside muted small">Refreshes every 2 seconds</span></div>
        <table>
          <thead><tr><th>File</th><th>Drive</th><th>Progress</th><th className="num">Speed</th><th className="num">Time left</th></tr></thead>
          <tbody>
            {transfers.length === 0 ? (
              <tr><td colSpan={5} className="empty-cell">{act === null ? "Checking…" : "Nothing is uploading right now."}</td></tr>
            ) : transfers.map((t, i) => (
              <tr key={i}>
                <td><span className="file-name"><FileIcon name={t.name} size={20} /><span title={t.name}>{t.name}</span></span></td>
                <td className="muted">{name(t.drive)}</td>
                <td className="progress-cell">
                  <div className="capacity"><i style={{ width: `${t.percent}%` }} /></div>
                  <span className="num muted small">{t.percent}% · {formatBytes(t.bytes)} of {formatBytes(t.size)}</span>
                </td>
                <td className="num">{speedText(t.speed)}</td>
                <td className="num">{etaText(t.eta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid12 below">
        <section className="panel span-5 scroll-panel">
          <div className="panel-head"><h2>Upload queue</h2><span className="aside">{plural(queue.length, "file")}</span></div>
          {queue.length === 0 ? <p className="empty-note">The queue is empty. Changes you save on a drive appear here until they're in OneDrive.</p> : (
            <ul className="queue">
              {queue.map((q, i) => (
                <li key={i}>
                  <FileIcon name={q.name} size={22} />
                  <div className="cell"><strong title={q.name}>{q.name.split("/").pop()}</strong><span>{name(q.drive)} · {formatBytes(q.size)}</span></div>
                  <span className={`pill ${q.uploading ? "pill-starting" : q.tries ? "pill-error" : "pill-stopped"}`}><i className="dot" />{q.uploading ? "Uploading" : q.tries ? `Retry ${q.tries}` : "Waiting"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel span-7 scroll-panel">
          <div className="panel-head">
            <h2>Log</h2>
            <div className="seg aside-seg" role="radiogroup" aria-label="Drive">
              {profiles.map((p) => (
                <button key={p.id} role="radio" aria-checked={logDrive === p.id} className={logDrive === p.id ? "on" : ""} onClick={() => setLogDrive(p.id)}>{p.letter ? `${p.letter}:` : p.label}</button>
              ))}
            </div>
            <button className="icon-btn" title="Copy log" aria-label="Copy log" onClick={() => navigator.clipboard.writeText((lines ?? []).join("\n")).then(() => toast("Log copied", "ok"))}><Icon name="copy" size={16} /></button>
          </div>
          {lines === null ? <p className="empty-note">Reading the log…</p> : lines.length === 0 ? <p className="empty-note">Nothing logged yet for {name(logDrive)}. Connecting the drive starts its log.</p> : (
            <ol className="log">
              {lines.slice().reverse().map((l, i) => {
                const e = parseLine(l);
                return (
                  <li key={i} className={`lv-${e.level.toLowerCase()}`}>
                    <time title={e.date}>{e.time}</time>
                    <span>{e.text}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
