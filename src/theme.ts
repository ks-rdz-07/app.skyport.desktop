import { getCurrentWindow } from "@tauri-apps/api/window";

export type Theme = "system" | "light" | "dark";
const KEY = "skyport.theme";

export const getTheme = (): Theme => {
  try { return (localStorage.getItem(KEY) as Theme) || "system"; } catch { return "system"; }
};

/** Applies the appearance to the page and to the window's title bar. */
export function applyTheme(t: Theme) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* per-viewer convenience only */ }
  if ("__TAURI_INTERNALS__" in window) getCurrentWindow().setTheme(t === "system" ? null : t).catch(() => {});
}
