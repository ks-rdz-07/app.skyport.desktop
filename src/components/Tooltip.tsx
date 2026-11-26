import { useEffect, useState } from "react";

/** One styled tooltip for the whole app. It reads an element's data-tip, its title (moved into
 *  data-tip so the slow native tooltip never doubles it) or, for icon-only buttons, its aria-label.
 *  Shown on hover after a short delay and at once on keyboard focus. */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);

  useEffect(() => {
    let timer = 0;
    const target = (el: EventTarget | null) => (el instanceof Element ? el.closest<HTMLElement>("[data-tip],[title],button[aria-label]") : null);
    const textOf = (el: HTMLElement) => {
      if (el.title) { el.dataset.tip = el.title; el.removeAttribute("title"); }
      if (el.dataset.tip) return el.dataset.tip;
      // an icon-only button: its accessible name is the only label it has
      return el.tagName === "BUTTON" && !el.textContent?.trim() ? el.getAttribute("aria-label") ?? "" : "";
    };
    const show = (el: HTMLElement, delay: number) => {
      const text = textOf(el);
      window.clearTimeout(timer);
      if (!text) return setTip(null);
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const below = r.top < 48;
        setTip({ text, x: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140), y: below ? r.bottom + 8 : r.top - 8, below });
      }, delay);
    };
    const hide = () => { window.clearTimeout(timer); setTip(null); };
    const over = (e: PointerEvent) => { const el = target(e.target); el ? show(el, 350) : hide(); };
    const focus = (e: FocusEvent) => { const el = target(e.target); if (el && (e.target as Element).matches(":focus-visible")) show(el, 0); };
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  if (!tip) return null;
  return <div className={`tooltip ${tip.below ? "below" : ""}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>;
}
