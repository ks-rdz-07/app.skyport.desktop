import { useEffect, useState } from "react";
import { Account, CacheInfo, DriveStatus, Overview, Profile, Snapshot, TwoFaSetup, TwoFaStatus, api, formatBytes } from "@/api";
import { Capacity, freeLine } from "@/components/DriveCard";
import { AddAccount } from "@/components/Wizard";
import { Icon, Info, Modal, Spinner, Toggle } from "@/components/ui";
import { Theme, applyTheme, getTheme } from "@/theme";
import { AUTH_ICONS } from "@/components/authIcons";

type ToastFn = (msg: string, tone?: "ok" | "danger") => void;

export function Setup({ ov, onRecheck, checking }: { ov: Overview; onRecheck: () => void; checking: boolean }) {
  const items = [
    { key: "engine" as const, ok: !!ov.engineVersion, title: "Cloud engine", detail: ov.engineVersion ? `Installed · version ${ov.engineVersion.replace(/^v/, "")}` : "Connects SkyPort to OneDrive and keeps your files in sync.", hint: "Download the Windows 64-bit package, extract it, and place its contents in SkyPort's folder." },
    { key: "driver" as const, ok: ov.driver, title: "Drive driver", detail: ov.driver ? "Installed" : "Lets Windows show your OneDrive as a drive letter in This PC.", hint: "Download the latest installer and run it. Windows asks for administrator approval once." },
  ];
  const left = items.filter((i) => !i.ok).length;
  return (
    <div className="page">
      <header className="title-row">
        <div>
          <h1>Finish setting up</h1>
          <p className="finding">{left === 1 ? "One free component is missing." : `${left} free components are missing.`} Both download from their official websites.</p>
        </div>
        <div className="title-actions">
          <button className="btn" onClick={onRecheck} disabled={checking}>{checking ? <Spinner /> : <Icon name="refresh" size={16} />}Check again</button>
        </div>
      </header>
      <div className="setup-list">
        {items.map((it) => (
          <div key={it.key} className="setup-item">
            <span className={`pill ${it.ok ? "pill-connected" : "pill-starting"}`}><i className="dot" />{it.ok ? "Installed" : "Missing"}</span>
            <div className="setup-text">
              <strong>{it.title}</strong>
              <span className="muted">{it.detail}</span>
              {!it.ok && <small>{it.hint}</small>}
            </div>
            {!it.ok && <button className="btn btn-primary" onClick={() => api.openDownload(it.key)}><Icon name="external" size={16} />Download</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

type SettingsProps = { ov: Overview; cache?: CacheInfo; anyLive: boolean; onChanged: () => void; onTour: () => void; toast: ToastFn };

export function SettingsPage({ ov, cache, anyLive, onChanged, onTour, toast }: SettingsProps) {
  const [dir, setDir] = useState(ov.settings.cacheDir);
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState<Theme>(getTheme);
  useEffect(() => setDir(ov.settings.cacheDir), [ov.settings.cacheDir]);
  const suggested = "E:\\CloudDriveCache";
  const isDefault = ov.settings.cacheDir.toLowerCase() === ov.defaultCacheDir.toLowerCase();
  const waiting = cache ? Object.values(cache.waiting).reduce((a, b) => a + b, 0) : null;

  const saveDir = async (value = dir) => {
    setSaving(true);
    try {
      await api.setCacheDir(value);
      setDir(value);
      toast("Cache location updated", "ok");
      onChanged();
    } catch (e) {
      toast(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page settings">
      <header className="title-row">
        <div>
          <h1>Settings</h1>
          <p>Cache {cache ? formatBytes(cache.bytes) : "…"} on {ov.settings.cacheDir.slice(0, 2)} · {ov.settings.autoMount ? "starts with Windows" : "starts when you open it"}</p>
        </div>
      </header>

      <section className="set-row">
        <div className="set-label">
          <h2>Appearance</h2>
          <p>System follows your Windows setting and switches with it.</p>
        </div>
        <div className="set-panel">
          <div className="switch-row">
            <div><strong>Theme</strong><span>{theme === "system" ? "Matching Windows" : theme === "dark" ? "Always dark" : "Always light"}</span></div>
            <div className="seg" role="radiogroup" aria-label="Theme">
              {([["system", "monitor", "System"], ["light", "sun", "Light"], ["dark", "moon", "Dark"]] as const).map(([v, icon, label]) => (
                <button key={v} role="radio" aria-checked={theme === v} className={theme === v ? "on" : ""} onClick={() => { applyTheme(v); setTheme(v); }}>
                  <Icon name={icon} size={14} />{label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="set-row">
        <div className="set-label">
          <h2>Local cache</h2>
          <p>Files you change are saved here first and uploaded in the background. After a restart or a dropped connection, unfinished uploads continue from here.</p>
        </div>
        <div className="set-panel">
          <div className="cache-row">
            <label className="field grow">
              <span>Cache folder<Info text="Pick a folder on a drive with free space. SkyPort makes it private to your Windows account. Move it only when no drive is connected." /></span>
              <input value={dir} onChange={(e) => setDir(e.target.value)} disabled={anyLive} spellCheck={false} />
            </label>
            <button className="btn btn-primary" disabled={dir.trim() === ov.settings.cacheDir || saving || anyLive} onClick={() => saveDir()}>{saving && <Spinner />}Save</button>
          </div>
          <div className="row-actions" style={{ justifyContent: "flex-start" }}>
            {!isDefault && <button className="link-btn" disabled={anyLive || saving} onClick={() => saveDir(ov.defaultCacheDir)}>Use the private default (recommended)</button>}
            {ov.settings.cacheDir !== suggested && <button className="link-btn" disabled={anyLive || saving} onClick={() => saveDir(suggested)}>Use {suggested}</button>}
          </div>
          <p className="muted small"><Icon name="lock" size={12} /> Hidden in File Explorer and private to your Windows account, wherever it is.</p>
          {anyLive && <p className="note"><Icon name="lock" size={14} />Disconnect all drives to move the cache.</p>}
          <dl className="kv">
            <div><dt>Space used</dt><dd>{cache ? formatBytes(cache.bytes) : "—"}</dd></div>
            <div><dt>Waiting to upload<Info text="Files changed on this PC that are not in OneDrive yet. Moving the cache is blocked until this is 0." /></dt><dd>{waiting ?? "—"} {waiting === 1 ? "file" : "files"}</dd></div>
          </dl>
        </div>
      </section>

      <section className="set-row">
        <div className="set-label">
          <h2>Startup</h2>
          <p>SkyPort lives in the system tray. Closing the window keeps your drives connected.</p>
        </div>
        <div className="set-panel">
          <div className="switch-row">
            <div>
              <strong>Start with Windows {ov.settings.autoMount ? <span className="pill pill-connected"><i className="dot" />On</span> : <span className="pill pill-stopped"><i className="dot" />Off</span>}</strong>
              <span>Open in the tray when you sign in and connect every drive.</span>
            </div>
            <Toggle checked={ov.settings.autoMount} label="Start with Windows" onChange={(v) => api.setAutoMount(v).then(onChanged).catch((e) => toast(String(e)))} />
          </div>
        </div>
      </section>

      <section className="set-row">
        <div className="set-label">
          <h2>Help</h2>
          <p>A short walk through drives, details, accounts and security.</p>
        </div>
        <div className="set-panel">
          <div className="switch-row">
            <div><strong>Guided tour</strong><span>Seven steps, about 30 seconds.</span></div>
            <button className="btn" onClick={onTour}><Icon name="compass" size={16} />Take the tour</button>
          </div>
        </div>
      </section>

      <section className="set-row">
        <div className="set-label">
          <h2>About this PC</h2>
          <p>Components SkyPort relies on, checked each time it opens.</p>
        </div>
        <div className="set-panel">
          <dl className="list">
            <div><dt>Cloud engine</dt><dd>{ov.engineVersion ? ov.engineVersion.replace(/^v/, "Version ") : "Not installed"}</dd></div>
            <div><dt>Drive driver</dt><dd>{ov.driver ? "Installed" : "Not installed"}</dd></div>
            <div><dt>Computer</dt><dd>{ov.computer || "—"}</dd></div>
          </dl>
        </div>
      </section>
    </div>
  );
}

// People and accounts get a stable pale tint of their own hue (identity, not data).
const TINTS = [["#e3ecfb", "#1d4a8f"], ["#e6f4ea", "#1f5c33"], ["#fbe9e3", "#8a3b1d"], ["#efe9f7", "#4b3a73"], ["#e5f3f4", "#1e5a60"]];
const tint = (i: number) => TINTS[i % TINTS.length];

export function AccountsPage({ quotas, profiles, statuses, onChanged, toast }: { quotas: Record<string, Snapshot | "error">; profiles: Profile[]; statuses: Record<string, DriveStatus>; onChanged: () => void; toast: ToastFn }) {
  const [list, setList] = useState<Account[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Account | null>(null);
  const load = () => api.accounts().then(setList).catch((e) => { setList([]); toast(String(e)); });
  useEffect(() => { load(); }, []);

  const rename = async () => {
    if (!editing) return;
    try { await api.renameAccount(editing.id, editing.name); setEditing(null); load(); onChanged(); } catch (e) { toast(String(e)); }
  };
  const drives = profiles.length;

  return (
    <div className="page">
      <header className="title-row">
        <div>
          <h1>Accounts</h1>
          <p>{list ? `${list.length} Microsoft ${list.length === 1 ? "account" : "accounts"} · ${drives} ${drives === 1 ? "drive" : "drives"}` : "Loading…"}</p>
        </div>
        <div className="title-actions"><button className="btn btn-primary" onClick={() => setAdding(true)} data-tour="accounts"><Icon name="plus" size={16} />Add account</button></div>
      </header>

      <section className="panel drive-list">
        <div className="panel-head"><h2>Signed-in accounts</h2><span className="aside">Sign-ins stay on this PC</span></div>
        {list === null ? (
          <div className="account-row"><span /><div className="loading-row"><Spinner />Loading accounts…</div></div>
        ) : list.length === 0 ? (
          <div className="account-row"><span /><p className="empty-note">No accounts yet. Add one to create your first drive.</p></div>
        ) : (
          list.map((a, i) => {
            const q = quotas[a.id];
            const mine = profiles.filter((p) => p.remote === a.id);
            const up = mine.filter((p) => statuses[p.id]?.state === "connected").length;
            const st = mine.length === 0 ? "stopped" : up === mine.length ? "connected" : up > 0 ? "starting" : mine.some((p) => statuses[p.id]?.state === "error") ? "error" : "stopped";
            const label = mine.length === 0 ? "No drives" : up === mine.length ? "Connected" : up > 0 ? `${up} of ${mine.length} connected` : st === "error" ? "Needs attention" : "Not connected";
            const [bg, ink] = tint(i);
            return (
              <div key={a.id} className="account-row">
                <span className="avatar" style={{ background: bg, color: ink }}>{a.name.slice(0, 1).toUpperCase()}</span>
                <div className="cell">
                  {editing?.id === a.id ? (
                    <div className="inline-edit">
                      <input autoFocus value={editing.name} maxLength={40} aria-label="Account name" onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setEditing(null); }} />
                      <button className="btn btn-sm btn-primary" onClick={rename}>Save</button>
                    </div>
                  ) : <strong>{a.name}</strong>}
                  <span>{a.kind} · {a.drives.length ? a.drives.join(", ") : "No drives yet"}</span>
                </div>
                <div className="drive-id" style={{ gridTemplateColumns: "1fr" }}>
                  <Capacity q={q} />
                  <span className="drive-free num">{q && q !== "error" && q.total ? `${formatBytes(q.used)} used · ${freeLine(q)}` : freeLine(q)}</span>
                </div>
                <div className="row-actions">
                  <span className={`pill pill-${st}`}><i className="dot" />{label}</span>
                  <button className="icon-btn" title="Rename" aria-label={`Rename ${a.name}`} onClick={() => setEditing({ id: a.id, name: a.name })}><Icon name="edit" size={16} /></button>
                  <button className="icon-btn" title={a.drives.length ? "Remove its drives first" : "Remove account"} aria-label={`Remove ${a.name}`} disabled={a.drives.length > 0} onClick={() => setRemoving(a)}><Icon name="trash" size={16} /></button>
                </div>
              </div>
            );
          })
        )}
      </section>

      <div className="grid12 below">
        <section className="panel span-7">
          <div className="panel-head"><h2>Connect another account</h2></div>
          <AddAccount existing={list ?? []} onAdded={() => { load(); onChanged(); toast("Account added", "ok"); }} />
        </section>
        <section className="panel span-5">
          <div className="panel-head"><h2>What SkyPort keeps</h2></div>
          <dl className="list">
            <div><dt>Microsoft sign-in</dt><dd>On this PC, never shown</dd></div>
            <div><dt>Account names</dt><dd>Encrypted database</dd></div>
            <div><dt>Your files</dt><dd>Stay in OneDrive</dd></div>
            <div><dt>Removing an account</dt><dd>Signs it out here only</dd></div>
          </dl>
        </section>
      </div>

      {adding && (
        <Modal title="Add an account" onClose={() => setAdding(false)} width={540}>
          <AddAccount existing={list ?? []} onAdded={() => { setAdding(false); load(); onChanged(); toast("Account added", "ok"); }} />
        </Modal>
      )}
      {removing && (
        <Modal title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)} width={460} footer={<>
          <button className="btn" onClick={() => setRemoving(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={async () => { const a = removing; setRemoving(null); try { await api.removeAccount(a.id); load(); onChanged(); toast(`${a.name} removed`, "ok"); } catch (e) { toast(String(e)); } }}>Remove account</button>
        </>}>
          <p className="confirm-body">SkyPort signs <strong>{removing.name}</strong> out on this PC. Your files in OneDrive aren't touched, and you can add the account again at any time.</p>
        </Modal>
      )}
    </div>
  );
}

// Apps without a freely licensed official mark get a neutral lock glyph rather than an imitation logo.
const AUTH_APPS = ["Microsoft Authenticator", "Google Authenticator", "Authy", "1Password", "Bitwarden", "Aegis", "Ente Auth", "LastPass"];

function AppMark({ name }: { name: string }) {
  const icon = AUTH_ICONS[name];
  return icon ? (
    <svg className="app-mark" viewBox="0 0 24 24" role="img" aria-label={`${name} logo`}><path d={icon.path} fill={icon.hex} /></svg>
  ) : (
    <span className="app-mark neutral" aria-hidden="true"><Icon name="lock" size={14} /></span>
  );
}

export function SecurityPage({ ov, toast }: { ov: Overview; toast: ToastFn }) {
  const [st, setSt] = useState<TwoFaStatus | null>(null);
  const [setup, setSetup] = useState<TwoFaSetup | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => api.twofaStatus().then(setSt);
  useEffect(() => { load(); }, []);

  const begin = async () => { setError(""); setCode(""); try { setSetup(await api.twofaBegin()); } catch (e) { toast(String(e)); } };
  const enable = async () => { setBusy(true); setError(""); try { setCodes(await api.twofaEnable(code)); setSetup(null); load(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const disable = async () => { setBusy(true); setError(""); try { await api.twofaDisable(code); setDisabling(false); load(); toast("Two-step verification turned off", "ok"); } catch (e) { setError(String(e)); } finally { setBusy(false); } };

  return (
    <div className="page settings">
      <header className="title-row">
        <div>
          <h1>Security</h1>
          <p className="finding">{st?.enabled ? `Two-step verification is on · ${st.recoveryLeft} recovery ${st.recoveryLeft === 1 ? "code" : "codes"} left` : "Two-step verification is off. Anyone at this PC can open SkyPort."}</p>
        </div>
        <div className="title-actions">
          {st?.enabled ? (
            <button className="btn btn-primary" onClick={() => api.lockNow().then(() => window.dispatchEvent(new Event("skyport-locked")))}><Icon name="lock" size={16} />Lock now</button>
          ) : (
            <button className="btn btn-primary" onClick={begin} data-tour="security"><Icon name="phone" size={16} />Set up two-step verification</button>
          )}
        </div>
      </header>

      <section className="set-row">
        <div className="set-label">
          <h2>Private by design</h2>
          <p>SkyPort is an app on this PC, not a service. Just sign in and use it.</p>
        </div>
        <div className="set-panel">
          <dl className="list">
            <div><dt>SkyPort servers</dt><dd>None</dd></div>
            <div><dt>Your files</dt><dd>Go straight between this PC and OneDrive</dd></div>
            <div><dt>Sign-ins, settings, history</dt><dd>Stay on this PC, encrypted</dd></div>
            <div><dt>Accounts or tracking</dt><dd>None</dd></div>
          </dl>
        </div>
      </section>

      <section className="set-row">
        <div className="set-label">
          <h2>Two-step verification</h2>
          <p>Ask for a 6-digit code from an authenticator app when SkyPort opens, and again after 5 minutes in the tray. Your drives stay connected while it's locked.</p>
          <div className="app-list" aria-label="Supported authenticator apps">
            {AUTH_APPS.map((name) => <div key={name}><AppMark name={name} />{name}</div>)}
          </div>
        </div>
        <div className="set-panel">
          <div className="switch-row">
            <div>
              <strong>Code at sign-in {st?.enabled ? <span className="pill pill-connected"><i className="dot" />On</span> : <span className="pill pill-stopped"><i className="dot" />Off</span>}</strong>
              <span>{st?.enabled ? "Codes from your authenticator app unlock SkyPort." : "Works with any app that supports standard 6-digit codes."}</span>
            </div>
            {st?.enabled ? <button className="btn" onClick={() => { setCode(""); setError(""); setDisabling(true); }}>Turn off</button> : <button className="btn" onClick={begin}>Set up</button>}
          </div>
          <dl className="list">
            <div><dt>Recovery codes<Info text="Each recovery code unlocks SkyPort once if you lose your phone. You get 8 when you turn this on." /></dt><dd>{st?.enabled ? `${st.recoveryLeft} of 8 left` : "—"}</dd></div>
            <div><dt>Re-locks after</dt><dd>5 minutes in the tray</dd></div>
            <div><dt>Wrong codes</dt><dd>Paused after 5 tries, longer each time</dd></div>
          </dl>
        </div>
      </section>

      <section className="set-row">
        <div className="set-label">
          <h2>Virus scanning</h2>
          <p>Scan any file or folder from Files. Your antivirus also checks every file when it's opened from a drive.</p>
        </div>
        <div className="set-panel">
          <div className="switch-row">
            <div>
              <strong>On-demand scanner {ov.scanner ? <span className="pill pill-connected"><i className="dot" />{ov.scanner}</span> : <span className="pill pill-stopped"><i className="dot" />None found</span>}</strong>
              <span>{ov.scanner ? `Scans run with ${ov.scanner}, using its own up-to-date signatures.` : "Microsoft Defender is off because another antivirus is active, and ClamAV isn't installed."}</span>
            </div>
            {!ov.scanner && <button className="btn" onClick={() => api.openDownload("clamav")} title="Opens the official ClamAV download page"><Icon name="external" size={16} />Get ClamAV</button>}
          </div>
          <dl className="list">
            <div><dt>Checked first<Info text="SkyPort uses Microsoft Defender when its antivirus is running, otherwise ClamAV if it's installed." /></dt><dd>Microsoft Defender, then ClamAV</dd></div>
            <div><dt>Scanning a file</dt><dd>Downloads it to this PC first</dd></div>
            <div><dt>Threats found</dt><dd>Handled by the scanner and logged in Activity</dd></div>
          </dl>
        </div>
      </section>

      <section className="set-row">
        <div className="set-label">
          <h2>Encryption</h2>
          <p>Drives, account names, settings, storage history and activity are stored in an encrypted database that only your Windows account can open.</p>
        </div>
        <div className="set-panel">
          <dl className="list">
            <div><dt>Database</dt><dd>AES-256-GCM</dd></div>
            <div><dt>Key</dt><dd>256-bit, protected by Windows for {ov.user || "this account"}</dd></div>
            <div><dt>On uninstall</dt><dd>Removed with SkyPort</dd></div>
          </dl>
        </div>
      </section>

      {setup && (
        <Modal title="Set up two-step verification" onClose={() => setSetup(null)} width={560} footer={<>
          <button className="btn" onClick={() => setSetup(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={code.length < 6 || busy} onClick={enable}>{busy && <Spinner />}Turn on</button>
        </>}>
          <div className="twofa-setup">
            <img className="qr" alt="QR code for your authenticator app" src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} />
            <ol className="twofa-steps">
              <li>Open your authenticator app and add an account.</li>
              <li>Scan this QR code, or enter the key:
                <code className="secret">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
                <button className="link-btn" onClick={() => navigator.clipboard.writeText(setup.secret).then(() => toast("Key copied", "ok"))}>Copy key</button>
              </li>
              <li>Enter the 6-digit code it shows:
                <input className="code-input" inputMode="numeric" autoFocus maxLength={6} aria-label="Verification code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && code.length === 6 && enable()} />
              </li>
            </ol>
          </div>
          {error && <div className="inline-alert danger"><Icon name="alert" size={16} /><span>{error}</span></div>}
        </Modal>
      )}
      {codes && (
        <Modal title="Save your recovery codes" onClose={() => setCodes(null)} width={500} footer={<>
          <button className="btn" onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => toast("Recovery codes copied", "ok"))}><Icon name="copy" size={16} />Copy</button>
          <button className="btn btn-primary" onClick={() => setCodes(null)}>I've saved them</button>
        </>}>
          <p className="confirm-body">If you lose your phone, each code unlocks SkyPort once. Keep them somewhere safe; they won't be shown again.</p>
          <div className="recovery-grid">{codes.map((c) => <code key={c}>{c}</code>)}</div>
        </Modal>
      )}
      {disabling && (
        <Modal title="Turn off two-step verification?" onClose={() => setDisabling(false)} width={440} footer={<>
          <button className="btn" onClick={() => setDisabling(false)}>Cancel</button>
          <button className="btn btn-danger" disabled={code.length < 6 || busy} onClick={disable}>{busy && <Spinner />}Turn off</button>
        </>}>
          <p className="confirm-body">Enter a code from your authenticator app to confirm.</p>
          <input className="code-input" inputMode="numeric" autoFocus maxLength={6} aria-label="Verification code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          {error && <div className="inline-alert danger"><Icon name="alert" size={16} /><span>{error}</span></div>}
        </Modal>
      )}
    </div>
  );
}
