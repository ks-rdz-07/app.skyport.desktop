import { useEffect, useState } from "react";
import { Account, OS, Profile, api } from "@/api";
import { FolderGlyph, Icon, Info, Modal, Spinner } from "@/components/ui";

type Props = {
  initial?: Profile;
  usedLetters: string[];
  takenLetters: string[];
  onClose: () => void;
  onDone: (p: Profile) => void;
};

const LETTERS = "DEFGHIJKLMNOPQRSTUVWXYZ".split("");
const STEPS = ["Account", "Folder", "Drive"];

export function Wizard({ initial, usedLetters, takenLetters, onClose, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [account, setAccount] = useState(initial?.remote ?? "");
  const [wholeDrive, setWholeDrive] = useState(!initial?.path);
  const [path, setPath] = useState(initial?.path ?? "");
  const [browse, setBrowse] = useState(initial?.path ?? "");
  const [folders, setFolders] = useState<string[] | null>(null);
  const blocked = (l: string) => (usedLetters.includes(l) || takenLetters.includes(l)) && l !== initial?.letter;
  const [letter, setLetter] = useState(OS !== "windows" ? "" : initial?.letter ?? (["O", ...LETTERS].find((l) => !blocked(l)) || ""));
  const [label, setLabel] = useState(initial?.label ?? "");
  const [readOnly, setReadOnly] = useState(initial?.readOnly ?? false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadAccounts = async (select?: string) => {
    try {
      const list = await api.accounts();
      setAccounts(list);
      setAccount(select ?? (account || list[0]?.id || ""));
    } catch (e) {
      setAccounts([]);
      setError(String(e));
    }
  };
  useEffect(() => { loadAccounts(); }, []);

  useEffect(() => {
    if (step !== 1 || wholeDrive || !account) return;
    setFolders(null);
    setError("");
    api.listFolders(account, browse).then(setFolders).catch((e) => { setFolders([]); setError(String(e)); });
  }, [step, wholeDrive, account, browse]);

  const accountLabel = accounts?.find((a) => a.id === account)?.name ?? account;

  const next = () => {
    setError("");
    if (step === 1 && !label) {
      const base = wholeDrive || !path ? accountLabel : path.split("/").pop()!;
      setLabel(base.slice(0, 32));
    }
    setStep(step + 1);
  };

  const finish = async () => {
    setSaving(true);
    setError("");
    try {
      onDone(await api.saveProfile({ id: initial?.id ?? "", label: label.trim(), remote: account, path: wholeDrive ? "" : path, letter, readOnly }));
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const crumbs = browse ? browse.split("/") : [];
  const canNext = step === 0 ? !!account : step === 1 ? wholeDrive || !!path : (OS !== "windows" || !!letter) && !!label.trim();

  return (
    <Modal
      title={initial ? "Edit drive" : "Add a drive"}
      onClose={onClose}
      width={620}
      footer={
        <>
          {step > 0 && <button className="btn btn-ghost" onClick={() => { setError(""); setStep(step - 1); }}><Icon name="back" size={16} />Back</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          {step < 2 ? (
            <button className="btn btn-primary" disabled={!canNext} onClick={next}>Continue</button>
          ) : (
            <button className="btn btn-primary" disabled={!canNext || saving} onClick={finish}>
              {saving && <Spinner />}{initial ? "Save changes" : "Add and connect"}
            </button>
          )}
        </>
      }
    >
      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "current" : i < step ? "done" : ""}>
            <span className="step-num">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="wizard-section">
          <h4>Which OneDrive account?</h4>
          <p className="muted">Pick one of your accounts, or sign in with another Microsoft personal, work or school account.</p>
          {accounts === null ? (
            <div className="loading-row"><Spinner />Loading your accounts…</div>
          ) : (
            <div className="option-list">
              {accounts.map((a) => (
                <label key={a.id} className={`option ${account === a.id ? "selected" : ""}`}>
                  <input type="radio" name="account" checked={account === a.id} onChange={() => setAccount(a.id)} />
                  <span className="option-icon"><Icon name="cloud" /></span>
                  <span className="option-text">
                    <strong>{a.name}</strong>
                    <span className="muted">{a.kind}{a.drives.length > 0 && ` · ${a.drives.length} drive${a.drives.length > 1 ? "s" : ""}`}</span>
                  </span>
                </label>
              ))}
              {accounts.length === 0 && <p className="empty-note">No accounts yet. Sign in below to add your first one.</p>}
            </div>
          )}
          <AddAccount existing={accounts ?? []} onAdded={(id) => loadAccounts(id)} />
        </section>
      )}

      {step === 1 && (
        <section className="wizard-section">
          <h4>What should the drive show?</h4>
          <div className="segmented two">
            <button className={wholeDrive ? "active" : ""} onClick={() => setWholeDrive(true)}>
              <Icon name="cloud" /><span><strong>Entire OneDrive</strong><small>Every file and folder</small></span>
            </button>
            <button className={!wholeDrive ? "active" : ""} onClick={() => setWholeDrive(false)}>
              <Icon name="folder" /><span><strong>One folder</strong><small>Only the folder you pick</small></span>
            </button>
          </div>
          {!wholeDrive && (
            <div className="browser">
              <nav className="crumbs" aria-label="Folder path">
                <button onClick={() => setBrowse("")}>{accountLabel}</button>
                {crumbs.map((c, i) => (
                  <span key={i}><Icon name="chevron" size={13} /><button onClick={() => setBrowse(crumbs.slice(0, i + 1).join("/"))}>{c}</button></span>
                ))}
              </nav>
              <div className="folder-list">
                {folders === null ? (
                  <div className="loading-row"><Spinner />Loading folders…</div>
                ) : folders.length === 0 ? (
                  <p className="empty-note">No folders inside this one.</p>
                ) : (
                  folders.map((f) => {
                    const full = browse ? `${browse}/${f}` : f;
                    return (
                      <div key={f} className={`folder-row ${path === full ? "selected" : ""}`}>
                        <button className="folder-pick" onClick={() => setPath(full)}><FolderGlyph size={18} />{f}</button>
                        <button className="icon-btn" onClick={() => setBrowse(full)} aria-label={`Open ${f}`} title="Open folder"><Icon name="chevron" size={16} /></button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="browser-foot">
                {browse && <button className="btn btn-sm" onClick={() => setPath(browse)}>Use this folder</button>}
                <span className="muted">Selected: <strong>{path ? `/${path}` : "nothing yet"}</strong></span>
              </div>
            </div>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="wizard-section">
          <label className="field">
            <span>Drive name in File Explorer</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={32} placeholder="e.g. Work documents" />
          </label>
          {OS === "windows" ? (
          <div className="field">
            <span>Drive letter<Info text="The letter this drive gets in This PC. Letters already used on this PC, or by another drive, are crossed out." /></span>
            <div className="letter-grid" role="radiogroup" aria-label="Drive letter">
              {LETTERS.map((l) => (
                <button key={l} role="radio" aria-checked={letter === l} disabled={blocked(l)} className={letter === l ? "active" : ""} onClick={() => setLetter(l)} title={blocked(l) ? "Already in use" : `${l}:`}>
                  {l}
                </button>
              ))}
            </div>
            <small className="muted">Crossed-out letters are already used on this PC or by another drive.</small>
          </div>
          ) : (
            <div className="field">
              <span>Folder</span>
              <p className="muted">The drive appears as <strong>~/SkyPort/{label.trim() || "your drive name"}</strong>, ready to open like any other folder.</p>
            </div>
          )}
          <div className="field">
            <span>Access<Info text="Read only lets you open and copy files but not change or delete them. Useful for archives and shared folders." /></span>
            <div className="segmented two">
              <button className={!readOnly ? "active" : ""} onClick={() => setReadOnly(false)}>
                <Icon name="pencil" /><span><strong>Read &amp; write</strong><small>Edit, add and delete files</small></span>
              </button>
              <button className={readOnly ? "active" : ""} onClick={() => setReadOnly(true)}>
                <Icon name="lock" /><span><strong>Read only</strong><small>Open and copy files only</small></span>
              </button>
            </div>
          </div>
          <div className="summary">
            <Icon name="drive" />
            <span><strong>{label || "OneDrive"}{letter ? ` (${letter}:)` : ""}</strong> shows {wholeDrive ? "the entire OneDrive" : <>the folder <strong>/{path}</strong></>} of <strong>{accountLabel}</strong>.</span>
          </div>
        </section>
      )}

      {error && <div className="inline-alert danger"><Icon name="alert" size={16} /><span>{error}</span></div>}
    </Modal>
  );
}

/** Microsoft sign-in with a friendly account name. Shared by the wizard and Settings. */
export function AddAccount({ existing, onAdded }: { existing: Account[]; onAdded: (id: string) => void }) {
  const suggest = existing.length === 0 ? "Personal" : `OneDrive ${existing.length + 1}`;
  const [name, setName] = useState(suggest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setName(suggest), [suggest]);

  const signIn = async () => {
    setError("");
    setBusy(true);
    try {
      onAdded(await api.addAccount(name.trim()));
    } catch (e) {
      if (e !== "Sign-in was cancelled.") setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin-box">
      <div className="signin-text">
        <strong>Add another account</strong>
        <span className="muted">Your browser opens for Microsoft sign-in. Your sign-in is stored securely on this PC and is never shown in SkyPort.</span>
      </div>
      {busy ? (
        <div className="signin-progress">
          <Spinner />
          <span>Waiting for you to finish signing in… SkyPort continues on its own.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => api.cancelSignIn()}>Cancel</button>
        </div>
      ) : (
        <div className="signin-row">
          <label className="field compact">
            <span>Account name<Info text="Only shown in SkyPort, to tell your accounts apart. For example Personal or Work." /></span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Personal, Work" />
          </label>
          <button className="btn btn-ms" onClick={signIn} disabled={!name.trim()}>
            <MsMark />Sign in with Microsoft
          </button>
        </div>
      )}
      {error && <div className="inline-alert danger"><Icon name="alert" size={16} /><span>{error}</span></div>}
    </div>
  );
}

function MsMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
