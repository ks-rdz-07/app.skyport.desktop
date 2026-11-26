import { useEffect, useState } from "react";
import { DriveStatus, Entry, Profile, api, formatBytes, plural, tag, driveName } from "@/api";
import { FolderGlyph, Icon, Spinner } from "@/components/ui";
import { FileIcon } from "@/components/FileIcon";

type Props = { scanner: string | null; profiles: Profile[]; onSwitch: (id: string) => void; profile: Profile; status?: DriveStatus; onBack?: () => void; onDetails: () => void; onConnect: () => void; toast: (m: string, tone?: "ok" | "danger") => void };

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(+d)) return "—";
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? `Today ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};

function FileInfo({ p, path, items, sel, connected, onOpen, onRename, scanner, scanning, onScan }: { p: Profile; path: string; items: Entry[]; sel: Entry | null; connected: boolean; onOpen: (e: Entry, reveal?: boolean) => void; onRename: (e: Entry) => void; scanner: string | null; scanning: string | null; onScan: (e: Entry) => void }) {
  const files = items.filter((e) => !e.isDir);
  const largest = files.reduce<Entry | null>((a, e) => (!a || e.size > a.size ? e : a), null);
  const newest = items.reduce<Entry | null>((a, e) => (!a || e.modified > a.modified ? e : a), null);
  const where = (name?: string) => {
    const rel = [path, name].filter(Boolean).join("/");
    return p.letter ? `${p.letter}:\\${rel.replace(/\//g, "\\")}` : `${tag(p)}${rel ? "/" + rel : ""}`;
  };
  return (
    <section className="panel span-4">
      <div className="panel-head"><h2>{sel ? (sel.isDir ? "Folder" : "File") : "This folder"}</h2></div>
      {sel ? (
        <>
          <div className="file-title">{sel.isDir ? <FolderGlyph size={22} /> : <FileIcon name={sel.name} size={26} />}<strong>{sel.name}</strong></div>
          <dl className="list">
            <div><dt>Size</dt><dd className="num">{sel.isDir ? "—" : formatBytes(sel.size)}</dd></div>
            <div><dt>Modified</dt><dd className="num">{isNaN(+new Date(sel.modified)) ? "—" : new Date(sel.modified).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd></div>
            <div><dt>In File Explorer</dt><dd className="mono" title={where(sel.name)}>{where(sel.name)}</dd></div>
          </dl>
          <div className="title-actions">
            <button className="btn btn-primary" disabled={!connected} onClick={() => onOpen(sel)}>{sel.isDir ? "Open folder" : "Open"}</button>
            <button className="btn" disabled={!connected} onClick={() => onOpen(sel, true)}>Show in Explorer</button>
            <button className="btn" disabled={!scanner || scanning !== null} onClick={() => onScan(sel)} title={scanner ? `Scan with ${scanner}` : "No on-demand scanner on this PC"}>{scanning === sel.name ? <Spinner /> : <Icon name="shield" size={16} />}Scan for viruses</button>
            <button className="btn btn-ghost" disabled={p.readOnly} onClick={() => onRename(sel)} title={p.readOnly ? "This drive is read only" : undefined}>Rename</button>
          </div>
          {!connected && <p className="muted small">Connect the drive to open files from here.</p>}
        </>
      ) : (
        <dl className="list">
          <div><dt>Location</dt><dd className="mono">{where()}</dd></div>
          <div><dt>Folders and files</dt><dd className="num">{items.length - files.length} · {files.length}</dd></div>
          <div><dt>Largest file</dt><dd title={largest?.name}>{largest ? `${largest.name} · ${formatBytes(largest.size)}` : "—"}</dd></div>
          <div><dt>Last changed</dt><dd title={newest?.name}>{newest ? newest.name : "—"}</dd></div>
        </dl>
      )}
    </section>
  );
}

/** Browse a drive's folders and files, read from OneDrive itself. Opening goes through the mounted drive. */
export function FilesPage({ scanner, profiles, onSwitch, profile: p, status, onDetails, onConnect, toast }: Props) {
  const [path, setPath] = useState("");
  const [items, setItems] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const scanTip = scanner ? `Scan with ${scanner}` : "No on-demand scanner on this PC. Your antivirus still checks files when you open them.";
  const scan = async (e: Entry) => {
    if (e.isDir && !window.confirm(`Scanning "${e.name}" opens every file in it, which downloads them to this PC first. Continue?`)) return;
    setScanning(e.name);
    try {
      const r = await api.scanItem(p.id, child(e.name));
      toast(`${e.name}: ${r.detail} (${r.engine})`, r.clean ? "ok" : "danger");
    } catch (err) {
      toast(String(err));
    } finally {
      setScanning(null);
    }
  };
  const connected = status?.state === "connected";
  const drive = driveName(p);

  const load = () => {
    setItems(null);
    setError("");
    api.browse(p.id, path).then(setItems).catch((e) => { setItems([]); setError(String(e)); });
  };
  useEffect(() => { setFilter(""); setSel(null); if (connected) load(); }, [p.id, path, connected]);

  const parts = path ? path.split("/") : [];
  const shown = (items ?? []).filter((e) => e.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const folders = shown.filter((e) => e.isDir).length;
  const files = shown.length - folders;
  const bytes = shown.reduce((a, e) => a + (e.isDir || e.size < 0 ? 0 : e.size), 0);
  const child = (name: string) => (path ? `${path}/${name}` : name);
  const rename = async () => {
    if (!renaming) return;
    const { from, to } = renaming;
    if (!to.trim() || to.trim() === from) return setRenaming(null);
    try {
      await api.renameItem(p.id, child(from), to.trim());
      setRenaming(null);
      setSel(to.trim());
      api.browse(p.id, path).then(setItems).catch(() => {});
    } catch (err) {
      toast(String(err));
    }
  };
  const open = (e: Entry, reveal = false) => {
    if (e.isDir && !reveal) return setPath(child(e.name));
    api.openPath(p.id, child(e.name), reveal).catch((err) => toast(String(err)));
  };

  return (
    <div className="page">
      {profiles.length > 1 && (
        <div className="seg drive-switch" role="radiogroup" aria-label="Drive">
          {profiles.map((d) => (
            <button key={d.id} role="radio" aria-checked={d.id === p.id} className={d.id === p.id ? "on" : ""} onClick={() => onSwitch(d.id)}>
              <Icon name="drive" size={14} />{driveName(d)}
            </button>
          ))}
        </div>
      )}
      <header className="title-row">
        <div>
          <h1>Files in {drive}</h1>
          <button className="link-btn small" onClick={onDetails}>Drive details</button>
          <p>{!connected ? "This drive isn't connected." : items ? `${plural(folders, "folder")} and ${plural(files, "file")} · ${formatBytes(bytes)} in ${path ? `/${path}` : "the top folder"}` : "Reading from OneDrive…"}</p>
        </div>
        <div className="title-actions">
          {connected && <button className="btn btn-ghost" onClick={load} aria-label="Refresh"><Icon name="refresh" size={16} /></button>}
          {connected ? (
            <button className="btn btn-primary" onClick={() => api.openPath(p.id, path, false).catch((e) => toast(String(e)))}><Icon name="external" size={16} />Open this folder in Explorer</button>
          ) : null}
        </div>
      </header>

      {!connected ? (
        <section className="panel offline">
          <span className="offline-mark"><FolderGlyph size={34} /></span>
          <h2>Connect {drive} to browse its files</h2>
          <p>Files are shown while the drive is connected, so you can open, rename and find them straight away. Nothing is downloaded until you open a file.</p>
          <button className="btn btn-primary" onClick={onConnect}><Icon name="power" size={16} />Connect {p.label}</button>
        </section>
      ) : (
      <div className="grid12">
      <section className="panel files span-8">
        <div className="files-bar">
          <nav className="crumbs" aria-label="Folder path">
            <button onClick={() => setPath("")}><Icon name="drive" size={14} />{p.letter ? `${p.letter}:` : p.label}</button>
            {parts.map((c, i) => (
              <span key={i}><Icon name="chevron" size={12} /><button onClick={() => setPath(parts.slice(0, i + 1).join("/"))}>{c}</button></span>
            ))}
          </nav>
          <label className="search">
            <Icon name="search" size={14} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this folder" aria-label="Filter this folder" />
          </label>
        </div>

        {error ? (
          <div className="inline-alert danger"><Icon name="alert" size={16} /><span>{error}</span><button className="link-btn" onClick={load}>Retry</button></div>
        ) : items === null ? (
          <div className="loading-row"><Spinner />Reading this folder from OneDrive…</div>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th className="num">Modified</th><th className="num">Size</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {path && (
                <tr className="up"><td colSpan={4}><button className="file-name" onClick={() => setPath(parts.slice(0, -1).join("/"))}><Icon name="back" size={16} />Up one level</button></td></tr>
              )}
              {shown.length === 0 && (
                <tr><td colSpan={4} className="empty-cell">{filter ? `Nothing here matches "${filter}".` : "This folder is empty."}</td></tr>
              )}
              {shown.map((e) => (
                <tr key={e.name} className={sel === e.name ? "selected" : ""} onClick={() => setSel(e.name)}>
                  <td>
                    {renaming?.from === e.name ? (
                      <span className="file-name">
                        {e.isDir ? <FolderGlyph size={18} /> : <FileIcon name={e.name} size={20} />}
                        <input className="rename-input" autoFocus value={renaming.to} aria-label={`New name for ${e.name}`} maxLength={255}
                          onChange={(ev) => setRenaming({ ...renaming, to: ev.target.value })}
                          onFocus={(ev) => { const dot = e.isDir ? -1 : ev.target.value.lastIndexOf("."); ev.target.setSelectionRange(0, dot > 0 ? dot : ev.target.value.length); }}
                          onKeyDown={(ev) => { if (ev.key === "Enter") rename(); if (ev.key === "Escape") setRenaming(null); }}
                          onBlur={rename} />
                      </span>
                    ) : (
                      <button className="file-name" onClick={() => open(e)} onDoubleClick={() => !e.isDir && open(e)} title={e.isDir ? "Open folder" : connected ? "Open with its app" : "Connect the drive to open"}>
                        {e.isDir ? <FolderGlyph size={18} /> : <FileIcon name={e.name} size={20} />}<span>{e.name}</span>
                      </button>
                    )}
                  </td>
                  <td className="num">{fmtDate(e.modified)}</td>
                  <td className="num">{e.isDir ? "—" : formatBytes(e.size)}</td>
                  <td className="file-actions">
                    {!e.isDir && <button className="btn btn-sm btn-ghost" disabled={!connected} onClick={() => open(e)} title={connected ? "Open with its app" : "Connect the drive to open files"}>Open</button>}
                    <button className="icon-btn" title={scanTip} aria-label={`Scan ${e.name} for viruses`} disabled={!scanner || scanning !== null} onClick={(ev) => { ev.stopPropagation(); scan(e); }}>{scanning === e.name ? <Spinner size={14} /> : <Icon name="shield" size={15} />}</button>
                    <button className="icon-btn" title={`Rename ${e.name}`} aria-label={`Rename ${e.name}`} disabled={!!p.readOnly} onClick={(ev) => { ev.stopPropagation(); setRenaming({ from: e.name, to: e.name }); }}><Icon name="edit" size={15} /></button>
                    <button className="icon-btn" disabled={!connected} title={connected ? "Show in File Explorer" : "Connect to show in File Explorer"} aria-label={`Show ${e.name} in File Explorer`} onClick={() => open(e, true)}><Icon name="external" size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <FileInfo p={p} path={path} items={items ?? []} sel={(items ?? []).find((e) => e.name === sel) ?? null} connected={connected} onOpen={(e, r) => open(e, r)} onRename={(e) => setRenaming({ from: e.name, to: e.name })} scanner={scanner} scanning={scanning} onScan={scan} />
      </div>
      )}
    </div>
  );
}
