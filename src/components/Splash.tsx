import { CSSProperties, useEffect } from "react";
import { Icon, Logo, Wordmark } from "@/components/ui";

/** Every icon the app uses, each in its own colour: they drift in, orbit, close in and become the logo. */
const ICONS: [string, string, string][] = [
  ["drive", "#5B8CFF", "#3355E8"],
  ["cloud", "#38BDF8", "#0E83C9"],
  ["folder", "#FBBF24", "#F08A0C"],
  ["upload", "#34D399", "#0E9F6E"],
  ["download", "#2DD4BF", "#0F8F86"],
  ["lock", "#F472B6", "#D02F86"],
  ["database", "#E8836A", "#B5482F"],
  ["refresh", "#6F9BE8", "#2E5FB8"],
  ["check", "#4ADE80", "#16A34A"],
  ["shield", "#FB7185", "#E11D48"],
  ["globe", "#22D3EE", "#0891B2"],
  ["key", "#FCD34D", "#D97706"],
];

const SLOGANS = [
  "Your cloud storage, in one app.",
  "No servers in between. Just sign in.",
  "Files go straight from this PC to your cloud.",
];

export const SPLASH_MS = 10000;

export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(onDone, reduced ? 2500 : SPLASH_MS);
    const skip = (e: KeyboardEvent) => (e.key === "Escape" || e.key === "Enter" || e.key === " ") && onDone();
    window.addEventListener("keydown", skip);
    return () => { clearTimeout(t); window.removeEventListener("keydown", skip); };
  }, [onDone]);

  return (
    <div className="splash" onClick={onDone} role="img" aria-label="SkyPort is starting">
      <div className="sp-aurora"><i /><i /><i /><i /></div>
      <div className="sp-grid" />
      <div className="sp-orbit">
        {ICONS.map(([name, from, to], i) => {
          const a = (i / ICONS.length) * Math.PI * 2;
          const scatter = a + 0.6;
          const dist = 300 + (i % 3) * 70;
          const style = {
            "--rx": `${Math.cos(a) * 150}px`,
            "--ry": `${Math.sin(a) * 150}px`,
            "--sx": `${Math.cos(scatter) * dist}px`,
            "--sy": `${Math.sin(scatter) * dist * 0.62}px`,
            "--d": `${i * 0.12}s`,
            "--from": from,
            "--to": to,
          } as CSSProperties;
          return (
            <span key={name} className="sp-icon" style={style}>
              <span className="sp-icon-inner"><Icon name={name} size={26} /></span>
            </span>
          );
        })}
      </div>
      <div className="sp-burst" />
      <div className="sp-burst two" />
      <div className="sp-logo"><Logo size={112} /></div>
      <div className="sp-slogans" aria-hidden="true">
        {SLOGANS.map((s, i) => (
          <p key={s} style={{ ["--i" as string]: i }}>
            {s.split(" ").map((w, k) => <span key={k} style={{ ["--k" as string]: k }}>{w}&nbsp;</span>)}
          </p>
        ))}
      </div>
      <div className="sp-word">
        <h1><Wordmark size={46} /></h1>
        <p>Your OneDrive, right in File Explorer</p>
      </div>
      <button className="sp-skip" onClick={onDone}>Skip</button>
    </div>
  );
}
