import { useState } from "react";
import { api } from "@/api";
import { Icon, Logo, Spinner, Wordmark } from "@/components/ui";

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = recovery ? code.replace(/[^A-Za-z0-9]/g, "").length === 8 : code.length === 6;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.unlock(code);
      onUnlocked();
    } catch (e) {
      setError(String(e));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock">
      <div className="lock-card">
        <Logo size={56} />
        <Wordmark size={20} />
        <h1>Locked</h1>
        <p className="muted">{recovery ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app."}</p>
        <input
          className="code-input big"
          autoFocus
          inputMode={recovery ? "text" : "numeric"}
          maxLength={recovery ? 9 : 6}
          placeholder={recovery ? "XXXX-XXXX" : "000000"}
          value={code}
          onChange={(e) => setCode(recovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          aria-label={recovery ? "Recovery code" : "Verification code"}
        />
        {error && <div className="inline-alert danger"><Icon name="alert" size={16} /><span>{error}</span></div>}
        <button className="btn btn-primary btn-lg wide" disabled={!ready || busy} onClick={submit}>{busy ? <Spinner /> : <Icon name="lock" size={16} />}Unlock</button>
        <button className="link-btn" onClick={() => { setRecovery(!recovery); setCode(""); setError(""); }}>
          {recovery ? "Use my authenticator app" : "Lost your phone? Use a recovery code"}
        </button>
        <p className="lock-foot muted"><Icon name="shield" size={13} />Your drives stay connected while SkyPort is locked. Nothing leaves this PC.</p>
      </div>
    </div>
  );
}
