import { useEffect, useLayoutEffect, useState } from "react";
import { Icon } from "@/components/ui";

type Step = { target?: string; title: string; body: string };

const STEPS: Step[] = [
  { title: "Welcome to SkyPort", body: "SkyPort puts your OneDrive in File Explorer as a real drive letter. Here's a 30-second look around." },
  { target: "nav", title: "Find your way", body: "Drives shows everything you've connected. Settings holds your accounts, security and preferences." },
  { target: "add", title: "Add a drive", body: "Sign in with Microsoft, choose your whole OneDrive or one folder, and pick a drive letter. Add as many drives and accounts as you like." },
  { target: "drive-card", title: "Your drive at a glance", body: "Connect or disconnect, open it in File Explorer, and see storage and upload progress, all on one card." },
  { target: "details", title: "Every detail", body: "Storage history, account, cache and PC details for each drive, kept in an encrypted database on this PC." },
  { target: "summary", title: "Uploads you can trust", body: "Changes are saved locally first and uploaded in the background. If you go offline, they continue when you're back." },
  { target: "settings", title: "Make it yours", body: "Manage accounts, turn on two-step verification, move the cache and start SkyPort with Windows. You can replay this tour from Settings." },
];

export function Tour({ onClose }: { onClose: () => void }) {
  const steps = STEPS.filter((s) => !s.target || document.querySelector(`[data-tour="${s.target}"]`));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];

  useLayoutEffect(() => {
    const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const measure = () => setRect(el ? el.getBoundingClientRect() : null);
    measure();
    const t = setTimeout(measure, 320);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const next = () => (i < steps.length - 1 ? setI(i + 1) : onClose());
  const pad = 8;
  const pop = rect
    ? { top: Math.min(rect.bottom + 14, window.innerHeight - 230), left: Math.min(Math.max(16, rect.left), window.innerWidth - 376) }
    : { top: window.innerHeight / 2 - 110, left: window.innerWidth / 2 - 180 };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Guided tour">
      {rect ? (
        <div className="tour-hole" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-pop" style={pop} key={i}>
        <div className="tour-progress">{steps.map((_, k) => <i key={k} className={k <= i ? "on" : ""} />)}</div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button className="link-btn muted-link" onClick={onClose}>Skip tour</button>
          <span className="spacer" />
          {i > 0 && <button className="btn btn-sm" onClick={() => setI(i - 1)}><Icon name="back" size={14} />Back</button>}
          <button className="btn btn-sm btn-primary" onClick={next}>{i < steps.length - 1 ? "Next" : "Get started"}</button>
        </div>
      </div>
    </div>
  );
}
