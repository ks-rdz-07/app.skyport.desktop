import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CacheInfo, DriveStatus, Overview, PREVIEW, Profile, Snapshot, TwoFaStatus, accountName, api, formatBytes, plural, FM, OSNAME, OS, tag, driveName, HERE_CAP } from "@/api";
import { Capacity, DriveCard, freeLine } from "@/components/DriveCard";
import { Wizard } from "@/components/Wizard";
import { AccountsPage, SecurityPage, SettingsPage, Setup } from "@/components/Pages";
import { DetailsPage } from "@/components/Details";
import { FilesPage } from "@/components/Files";
import { ActivityPage } from "@/components/Activity";
import { LockScreen } from "@/components/Lock";
import { Tour } from "@/components/Tour";
import { Splash } from "@/components/Splash";
import { TooltipLayer } from "@/components/Tooltip";
import { Theme, applyTheme } from "@/theme";
import { Confirm, ConfirmRequest, Icon, Info, Logo, Toggle, Wordmark } from "@/components/ui";

type Toast = { id: number; msg: string; tone: "ok" | "danger" };
type Page = { name: "drives" | "activity" | "accounts" | "security" | "settings" } | { name: "details" | "files"; id: string };

const TOUR_KEY = "skyport.tourDone";
const tourDone = () => { if (PREVIEW) return true; try { return localStorage.getItem(TOUR_KEY) === "1"; } catch { return true; } };

// Each area is its own view: #/drives, #/accounts, #/security, #/settings, #/drives/<id>.
const readHash = (): Page => {
  const [, area, id, sub] = location.hash.split("/");
  if (area === "drives" && id) return { name: sub === "files" ? "files" : "details", id };
  if (area === "files") return { name: "files", id: id ?? "" };
  if (area === "activity" || area === "accounts" || area === "security" || area === "settings") return { name: area };
  return { name: "drives" };
};
const toHash = (p: Page) => (p.name === "details" ? `#/drives/${p.id}` : p.name === "files" ? `#/files/${p.id}` : `#/${p.name}`);

const NAV = [
  { name: "drives", label: "Drives", icon: "drive" },
  { name: "files", label: "Files", icon: "folder" },
  { name: "activity", label: "Activity", icon: "activity" },
  { name: "accounts", label: "Accounts", icon: "user" },
  { name: "security", label: "Security", icon: "shield" },
  { name: "settings", label: "Settings", icon: "settings" },
] as const;

export default function App() {
  const [splash, setSplash] = useState(!PREVIEW || location.search.includes("splash"));
  const [locked, setLocked] = useState<boolean | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [page, setPageState] = useState<Page>(readHash);
  const [menu, setMenu] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, DriveStatus>>({});
  const [cache, setCache] = useState<CacheInfo>();
  const [quotas, setQuotas] = useState<Record<string, Snapshot | "error">>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [wizard, setWizard] = useState<{ edit?: Profile } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [checking, setChecking] = useState(false);
  const [tour, setTour] = useState(false);
  const [twofa, setTwofa] = useState<TwoFaStatus | null>(null);
  const toastId = useRef(0);
  const endSplash = useCallback(() => setSplash(false), []); // stable, so re-renders don't restart the splash timer
  const lockedRef = useRef(false);
  lockedRef.current = locked !== false;

  const setPage = (p: Page) => { setMenu(false); if (location.hash !== toHash(p)) location.hash = toHash(p); setPageState(p); };
  useEffect(() => {
    const onHash = () => setPageState(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const toast = useCallback((msg: string, tone: "ok" | "danger" = "danger") => {
    if (msg === "LOCKED") return;
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "ok" ? 4000 : 9000);
  }, []);

  const refreshOverview = useCallback(async () => {
    const o = await api.overview();
    if (o.installTheme) applyTheme(o.installTheme as Theme); // the installer's choice, delivered once
    setOv(o);
  }, []);
  const refreshStatus = useCallback(async () => {
    const list = await api.status();
    setStatuses(Object.fromEntries(list.map((s) => [s.id, s])));
  }, []);
  const refreshCache = useCallback(async () => setCache(await api.cacheInfo()), []);
  const refreshQuota = useCallback((account: string) => {
    api.quota(account).then((q) => setQuotas((m) => ({ ...m, [account]: q }))).catch(() => setQuotas((m) => ({ ...m, [account]: "error" })));
  }, []);
  const refreshAll = useCallback(() => {
    refreshOverview().catch((e) => toast(String(e)));
    refreshStatus().catch(() => {});
    refreshCache().catch(() => {});
  }, []);

  useEffect(() => {
    api.twofaStatus().then((s) => {
      setLocked(s.locked);
      setTwofa(s);
      if (!s.locked) refreshAll();
    });
    const onLocked = () => setLocked(true);
    window.addEventListener("skyport-locked", onLocked);
    const safeListen = <T,>(ev: string, f: (e: { payload: T }) => void) => (PREVIEW ? Promise.resolve(() => {}) : listen<T>(ev, f));
    const unLocked = safeListen("locked", onLocked);
    const s = setInterval(() => !lockedRef.current && refreshStatus().catch(() => {}), 2000);
    const c = setInterval(() => !lockedRef.current && refreshCache().catch(() => {}), 10000);
    const unChanged = safeListen("drives-changed", () => { refreshStatus().catch(() => {}); refreshOverview().catch(() => {}); });
    const unConfirm = safeListen<{ action: "quit" | "disconnect-all"; pending: number }>("confirm-action", (e) => {
      const quit = e.payload.action === "quit";
      setConfirm({
        title: quit ? "Quit while files are uploading?" : "Disconnect while files are uploading?",
        body: <PendingNote count={e.payload.pending} />,
        confirm: quit ? "Quit anyway" : "Disconnect anyway",
        danger: true,
        onConfirm: () => (quit ? api.quit() : api.unmountAll().then(refreshStatus)),
      });
    });
    return () => {
      clearInterval(s); clearInterval(c);
      window.removeEventListener("skyport-locked", onLocked);
      [unLocked, unChanged, unConfirm].forEach((u) => u.then((f) => f()));
    };
  }, []);

  // Storage per account: on load and every 5 minutes (each reading is kept in the encrypted history).
  const accountsKey = [...new Set(ov?.settings.profiles.map((p) => p.remote) ?? [])].join(",");
  useEffect(() => {
    if (!ov?.engineVersion || !accountsKey || locked) return;
    const load = () => accountsKey.split(",").forEach(refreshQuota);
    load();
    const t = setInterval(load, 300000);
    return () => clearInterval(t);
  }, [accountsKey, ov?.engineVersion, locked]);

  useEffect(() => {
    if (!splash && locked === false && ov && !tourDone()) setTimeout(() => setTour(true), 400);
  }, [splash, locked, !!ov]);
  const endTour = () => { setTour(false); try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* per-viewer convenience only */ } };

  const run = async (id: string, label: string, fn: () => Promise<void>, done?: string) => {
    setBusy((b) => ({ ...b, [id]: label }));
    try {
      await fn();
      if (done) toast(done, "ok");
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(({ [id]: _, ...rest }) => rest);
      refreshAll();
    }
  };

  if (splash) return <Splash onDone={endSplash} />;
  if (locked) return <LockScreen onUnlocked={() => { setLocked(false); refreshAll(); }} />;
  if (!ov) return <Boot />;

  const ready = !!ov.engineVersion && ov.driver;
  const profiles = ov.settings.profiles;
  const st = (p: Profile) => statuses[p.id];
  const connected = profiles.filter((p) => st(p)?.state === "connected");
  const problems = profiles.filter((p) => st(p)?.state === "error");
  const anyLive = profiles.some((p) => st(p)?.state === "connected" || st(p)?.state === "starting");
  const uploading = profiles.map((p) => ({ p, n: (st(p)?.uploading ?? 0) + (st(p)?.queued ?? 0) })).filter((x) => x.n > 0);
  const waiting = profiles.map((p) => ({ p, n: cache?.waiting[p.id] ?? 0 })).filter((x) => x.n > 0 && !uploading.some((u) => u.p.id === x.p.id));
  const pendingTotal = [...uploading, ...waiting].reduce((a, x) => a + x.n, 0);
  const accountIds = [...new Set(profiles.map((p) => p.remote))];
  const usedTotal = accountIds.reduce((a, id) => { const q = quotas[id]; return a + (q && q !== "error" ? q.used ?? 0 : 0); }, 0);
  const name = driveName;

  const finding =
    problems.length > 0 ? `${name(problems[0])} needs attention: ${st(problems[0])?.error ?? "it stopped unexpectedly"}`
    : uploading.length > 0 ? `${plural(uploading[0].n, "file")} uploading to ${name(uploading[0].p)}. Keep it connected to finish.`
    : waiting.length > 0 ? `${plural(waiting[0].n, "file")} on ${name(waiting[0].p)} waiting to upload. Connect it to finish.`
    : connected.length === profiles.length ? "Every drive is in File Explorer and every change is uploaded."
    : `${connected.length} of ${profiles.length} drives in File Explorer. Everything is uploaded.`;

  const connect = (p: Profile) => run(p.id, "connecting", () => api.mount(p.id), `${p.label} is ready in ${OS === "windows" ? "This PC as" : FM + " at"} ${tag(p)}`);
  const disconnect = (p: Profile) => {
    const pending = (st(p)?.uploading ?? 0) + (st(p)?.queued ?? 0);
    const go = () => run(p.id, "disconnecting", () => api.unmount(p.id), `${p.label} disconnected`);
    if (pending > 0) setConfirm({ title: `Disconnect ${p.label}?`, body: <PendingNote count={pending} />, confirm: "Disconnect anyway", danger: true, onConfirm: go });
    else go();
  };
  const remove = (p: Profile) =>
    setConfirm({
      title: `Remove ${name(p)}?`,
      body: <p>The drive is removed from SkyPort and from This PC. Your files in OneDrive and your account sign-in aren't affected.</p>,
      confirm: "Remove drive",
      danger: true,
      onConfirm: () => run(p.id, "removing", () => api.removeProfile(p.id), `${p.label} removed`),
    });
  // Files opens on the chosen drive, else the first connected one, else the first drive.
  const filesId = page.name === "files" ? page.id || connected[0]?.id || profiles[0]?.id : undefined;
  const detailsProfile = profiles.find((p) => p.id === (page.name === "files" ? filesId : page.name === "details" ? page.id : ""));
  const navActive = page.name === "details" ? "drives" : page.name;

  return (
    <div className="shell">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <div className="brand"><Logo size={26} /><Wordmark size={17} /></div>
        <div className="scope" title="Drives on this PC"><Icon name="monitor" size={15} /><span>{HERE_CAP} · {ov.computer || OSNAME}</span></div>
        <button className="icon-btn menu-btn" aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name={menu ? "close" : "menu"} size={20} /></button>
        <nav className="nav" data-tour="nav" aria-label="Main">
          {NAV.map((n) => (
            <button key={n.name} className={navActive === n.name ? "active" : ""} aria-current={navActive === n.name ? "page" : undefined} onClick={() => setPage(n.name === "files" ? { name: "files", id: "" } : { name: n.name })} data-tour={n.name === "settings" ? "settings" : undefined}>
              <Icon name={n.icon} size={16} />{n.label}
              {n.name === "drives" && problems.length > 0 && <span className="count" title="Drives that need attention">{problems.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={`health ${!ready ? "warn" : problems.length ? "warn" : connected.length ? "" : "idle"}`}>
            <i className="dot" />
            <span>{!ready ? "Setup needed" : problems.length ? "A drive needs attention" : `${connected.length} of ${profiles.length} drives connected`}</span>
          </div>
          <small title="SkyPort has no servers. Files move directly between this PC and your cloud; everything else stays on this PC, encrypted."><Icon name="shield" size={12} />Local only · no servers</small>
        </div>
      </aside>

      <main className="main">
        {ov.elevated && (
          <div className="banner"><Icon name="alert" size={16} />SkyPort is running as administrator, so drives connected now would be hidden from File Explorer. Close it and open it normally.</div>
        )}

        {page.name === "settings" ? (
          <SettingsPage ov={ov} cache={cache} anyLive={anyLive} onTour={() => { setPage({ name: "drives" }); setTimeout(() => setTour(true), 200); }} onChanged={refreshAll} toast={toast} />
        ) : page.name === "activity" ? (
          <ActivityPage profiles={profiles} statuses={statuses} toast={toast} />
        ) : page.name === "accounts" ? (
          <AccountsPage quotas={quotas} profiles={profiles} statuses={statuses} onChanged={refreshAll} toast={toast} />
        ) : page.name === "security" ? (
          <SecurityPage ov={ov} toast={toast} />
        ) : !ready ? (
          <Setup ov={ov} checking={checking} onRecheck={async () => { setChecking(true); await refreshOverview().catch(() => {}); setChecking(false); }} />
        ) : page.name === "files" && !detailsProfile ? (
          <div className="page"><header className="title-row"><div><h1>Files</h1><p>Add a drive to browse its files here.</p></div></header></div>
        ) : page.name === "files" && detailsProfile ? (
          <FilesPage
            scanner={ov.scanner}
            profiles={profiles}
            onSwitch={(id) => setPage({ name: "files", id })}
            profile={detailsProfile}
            status={statuses[detailsProfile.id]}
            onBack={() => setPage({ name: "drives" })}
            onDetails={() => setPage({ name: "details", id: detailsProfile.id })}
            onConnect={() => connect(detailsProfile)}
            toast={toast}
          />
        ) : page.name === "details" && detailsProfile ? (
          <DetailsPage
            id={page.id}
            status={statuses[page.id]}
            onBack={() => setPage({ name: "drives" })}
            onOpen={() => api.openDrive(detailsProfile.id).catch((e) => toast(String(e)))}
            onConnect={() => connect(detailsProfile)}
            onDisconnect={() => disconnect(detailsProfile)}
            onFiles={() => setPage({ name: "files", id: detailsProfile.id })}
          />
        ) : (
          <div className="page">
            <header className="title-row">
              <div>
                <h1>Drives</h1>
                <p className={problems.length || pendingTotal ? "finding" : ""}>{profiles.length ? finding : "Add your OneDrive as a drive letter in File Explorer."}</p>
              </div>
              <div className="title-actions">
                <button className="btn btn-primary" onClick={() => setWizard({})} data-tour="add"><Icon name="plus" size={16} />Add drive</button>
              </div>
            </header>

            {profiles.length > 0 && (
              <dl className="strip" data-tour="summary">
                <div><dt>In File Explorer</dt><dd>{connected.length}<small>of {profiles.length}</small></dd><span className="sub">{connected.length ? connected.map(tag).join(" ") : "No drive connected"}</span></div>
                <div><dt>Waiting to upload<Info text="Changes you save on a drive are kept on this PC until they are in OneDrive. They upload in the background, even after a restart." /></dt><dd>{pendingTotal}<small>{pendingTotal === 1 ? "file" : "files"}</small></dd><span className="sub">{pendingTotal ? [...uploading, ...waiting].map((x) => name(x.p)).join(", ") : "All changes uploaded"}</span></div>
                <div><dt>OneDrive storage used</dt><dd>{formatBytes(usedTotal)}</dd><span className="sub">across {plural(accountIds.length, "account")}</span></div>
                <div><dt>Local cache<Info text="Copies of files you opened or changed, kept on this PC so they open fast and upload safely. Only your Windows account can open this folder." /></dt><dd>{cache ? formatBytes(cache.bytes) : "—"}</dd><button className="sub" onClick={() => setPage({ name: "settings" })} title="Change the cache folder">{ov.settings.cacheDir}</button></div>
              </dl>
            )}

            {profiles.length === 0 ? (
              <div className="empty">
                <h2>No drives yet</h2>
                <p>Sign in with Microsoft, choose your whole OneDrive or one folder, and pick a letter. The drive appears in This PC like any other. There are no SkyPort servers: your files go straight between this PC and OneDrive.</p>
                <button className="btn btn-primary" onClick={() => setWizard({})}><Icon name="plus" size={16} />Add your first drive</button>
              </div>
            ) : (
              <section className="panel drive-list">
                <div className="panel-head"><h2>Your drives</h2><span className="aside">{plural(profiles.length, "drive")} · {plural(accountIds.length, "account")}</span></div>
                {profiles.map((p) => (
                  <DriveCard
                    key={p.id}
                    profile={p}
                    account={accountName(ov.settings, p.remote)}
                    status={statuses[p.id]}
                    quota={quotas[p.remote]}
                    waiting={cache?.waiting[p.id] ?? 0}
                    busy={busy[p.id]}
                    onConnect={() => connect(p)}
                    onDisconnect={() => disconnect(p)}
                    onReconnect={() => run(p.id, "connecting", () => api.reconnect(p.id), `${p.label} reconnected`)}
                    onOpen={() => api.openDrive(p.id).catch((e) => toast(String(e)))}
                    onDetails={() => setPage({ name: "details", id: p.id })}
                    onFiles={() => setPage({ name: "files", id: p.id })}
                    onEdit={() => setWizard({ edit: p })}
                    onRemove={() => remove(p)}
                  />
                ))}
              </section>
            )}

            {profiles.length > 0 && (
              <div className="grid12 below">
                <section className="panel span-7">
                  <div className="panel-head"><h2>Storage by account</h2><button className="link-btn aside" onClick={() => setPage({ name: "accounts" })}>Manage accounts</button></div>
                  <div className="acct-bars">
                    {accountIds.map((id) => {
                      const q = quotas[id];
                      const n = profiles.filter((p) => p.remote === id);
                      return (
                        <div key={id}>
                          <div className="acct-line"><strong>{accountName(ov.settings, id)}</strong><span className="num">{q && q !== "error" && q.total ? `${formatBytes(q.used)} used` : ""}</span></div>
                          <Capacity q={q} />
                          <div className="acct-line muted small"><span>{OS === "windows" ? n.map(tag).join(" ") : n.map((p) => p.label).join(", ")} · {plural(n.length, "drive")}</span><span className="num">{freeLine(q)}</span></div>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section className="panel span-5">
                  <div className="panel-head"><h2>On this PC</h2><button className="link-btn aside" onClick={() => setPage({ name: "settings" })}>Settings</button></div>
                  <dl className="list">
                    <div><dt>Start with Windows<Info text="SkyPort opens in the system tray when you sign in and reconnects every drive." /></dt><dd><Toggle checked={ov.settings.autoMount} label="Start with Windows" onChange={(v) => api.setAutoMount(v).then(refreshAll).catch((e) => toast(String(e)))} /></dd></div>
                    <div><dt>Cache folder</dt><dd title="Only your Windows account can open it">{ov.settings.cacheDir} · private</dd></div>
                    <div><dt>Two-step verification</dt><dd><button className="link-btn" onClick={() => setPage({ name: "security" })}>{twofa?.enabled ? "On" : "Off · set up"}</button></dd></div>
                    <div><dt>Cloud engine and driver</dt><dd>Ready · {ov.engineVersion}</dd></div>
                  </dl>
                </section>
              </div>
            )}
          </div>
        )}
      </main>

      {wizard && (
        <Wizard
          initial={wizard.edit}
          usedLetters={ov.usedLetters}
          takenLetters={profiles.filter((p) => p.id !== wizard.edit?.id).map((p) => p.letter)}
          onClose={() => setWizard(null)}
          onDone={(p) => {
            const isNew = !wizard.edit;
            setWizard(null);
            refreshAll();
            refreshQuota(p.remote);
            if (isNew) connect(p);
            else toast("Drive updated", "ok");
          }}
        />
      )}
      {confirm && <Confirm req={confirm} onClose={() => setConfirm(null)} />}
      {tour && <Tour onClose={endTour} />}
      <TooltipLayer />

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <Icon name={t.tone === "ok" ? "check" : "alert"} size={16} />
            <span>{t.msg}</span>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><Icon name="close" size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shown while the first data loads: a full-window overlay with the logo in a turning ring. */
function Boot() {
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot-mark">
        <svg className="ring" viewBox="0 0 100 100" aria-hidden="true"><circle className="track" cx="50" cy="50" r="48" /><circle className="arc" cx="50" cy="50" r="48" /></svg>
        <span className="logo"><Logo size={48} /></span>
      </div>
      <Wordmark size={22} />
      <p>Getting your drives ready…</p>
    </div>
  );
}

function PendingNote({ count }: { count: number }) {
  return (
    <p>
      <strong>{plural(count, "file")}</strong> {count === 1 ? "is" : "are"} still uploading to OneDrive. They're kept safely on this PC and finish uploading the next
      time you connect this drive.
    </p>
  );
}
