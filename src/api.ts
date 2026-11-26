import { invoke } from "@tauri-apps/api/core";

export type Profile = { id: string; label: string; remote: string; path: string; letter: string; readOnly: boolean };
export type Settings = { cacheDir: string; autoMount: boolean; profiles: Profile[]; accountNames: Record<string, string>; connected: string[] };
export type Overview = { engineVersion: string | null; driver: boolean; elevated: boolean; settings: Settings; usedLetters: string[]; computer: string; user: string; installTheme?: string | null; defaultCacheDir: string; scanner: string | null; platform: "windows" | "macos" | "linux"; mountRoot: string };
export type ScanResult = { engine: string; clean: boolean; detail: string };
export type DriveState = "stopped" | "starting" | "connected" | "error";
export type DriveStatus = { id: string; state: DriveState; error: string | null; uploading: number; queued: number; failed: number };
export type CacheInfo = { bytes: number; waiting: Record<string, number> };
export type Account = { id: string; name: string; kind: string; drives: string[] };
export type Snapshot = { at: number; total: number | null; used: number | null; free: number | null; trashed: number | null };
export type DriveEvent = { at: number; kind: string; detail: string };
export type Details = {
  profile: Profile;
  account: Account;
  quota: Snapshot | null;
  quotaError: string | null;
  history: Snapshot[];
  events: DriveEvent[];
  cacheDir: string;
  cacheBytes: number;
  waiting: number;
  pc: { computer: string; user: string; localIp: string | null };
};
export type Entry = { name: string; isDir: boolean; size: number; modified: string };
export type Transfer = { name: string; size: number; bytes: number; percent: number; speed: number; eta: number | null };
export type Queued = { name: string; size: number; tries: number; uploading: boolean };
export type DriveActivity = { id: string; speed: number; transferred: number; errors: number; transfers: Transfer[]; queue: Queued[] };
export type TwoFaStatus = { enabled: boolean; locked: boolean; recoveryLeft: number };
export type TwoFaSetup = { secret: string; qrSvg: string };

/** Browser preview with sample data (dev only; never in the shipped app). */
export const PREVIEW = import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);

/** Rust refuses every command while the app is locked; tell the shell to show the lock screen. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (import.meta.env.DEV && PREVIEW) return (await import("@/dev/mock")).mock(cmd, args) as Promise<T>;
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (e === "LOCKED") window.dispatchEvent(new Event("skyport-locked"));
    throw e;
  }
}

export const api = {
  overview: () => call<Overview>("overview"),
  status: () => call<DriveStatus[]>("status"),
  cacheInfo: () => call<CacheInfo>("cache_info"),
  accounts: () => call<Account[]>("accounts"),
  addAccount: (name: string) => call<string>("add_account", { name }),
  cancelSignIn: () => call<void>("cancel_sign_in"),
  renameAccount: (id: string, name: string) => call<void>("rename_account", { id, name }),
  removeAccount: (id: string) => call<void>("remove_account", { id }),
  listFolders: (account: string, path: string) => call<string[]>("list_folders", { account, path }),
  quota: (account: string) => call<Snapshot>("quota", { account }),
  details: (id: string) => call<Details>("details", { id }),
  activity: () => call<DriveActivity[]>("activity"),
  logs: (id: string) => call<string[]>("logs", { id }),
  openLogs: () => call<void>("open_logs"),
  browse: (id: string, path: string) => call<Entry[]>("browse", { id, path }),
  scanItem: (id: string, path: string) => call<ScanResult>("scan_item", { id, path }),
  renameItem: (id: string, path: string, name: string) => call<string>("rename_item", { id, path, name }),
  openPath: (id: string, path: string, reveal: boolean) => call<void>("open_path", { id, path, reveal }),
  saveProfile: (profile: Profile) => call<Profile>("save_profile", { profile }),
  removeProfile: (id: string) => call<void>("remove_profile", { id }),
  mount: (id: string) => call<void>("mount", { id }),
  unmount: (id: string) => call<void>("unmount", { id }),
  reconnect: (id: string) => call<void>("reconnect", { id }),
  unmountAll: () => call<void>("unmount_all"),
  setCacheDir: (path: string) => call<void>("set_cache_dir", { path }),
  setAutoMount: (enabled: boolean) => call<void>("set_auto_mount", { enabled }),
  openDrive: (id: string) => call<void>("open_drive", { id }),
  openDownload: (which: "engine" | "driver" | "clamav") => call<void>("open_download", { which }),
  quit: () => call<void>("quit_app"),
  twofaStatus: () => call<TwoFaStatus>("twofa_status"),
  unlock: (code: string) => call<void>("unlock", { code }),
  lockNow: () => call<void>("lock_now"),
  twofaBegin: () => call<TwoFaSetup>("twofa_begin"),
  twofaEnable: (code: string) => call<string[]>("twofa_enable", { code }),
  twofaDisable: (code: string) => call<void>("twofa_disable", { code }),
};

/** The system SkyPort runs on, and the words people use for its parts. */
const devOs = import.meta.env.DEV ? new URLSearchParams(location.search).get("os") : null;
export const OS: "windows" | "macos" | "linux" =
  devOs === "macos" || devOs === "linux" || devOs === "windows" ? devOs : /Windows/i.test(navigator.userAgent) ? "windows" : /Mac/i.test(navigator.userAgent) ? "macos" : "linux";
export const FM = { windows: "File Explorer", macos: "Finder", linux: "your file manager" }[OS];
export const FMS = { windows: "Explorer", macos: "Finder", linux: "Files" }[OS];
export const HERE = { windows: "this PC", macos: "this Mac", linux: "this computer" }[OS];
export const HERE_CAP = { windows: "This PC", macos: "This Mac", linux: "This computer" }[OS];
export const OSNAME = { windows: "Windows", macos: "macOS", linux: "Linux" }[OS];
/** Where a drive shows up: "O:" on Windows, ~/SkyPort/<name> on macOS and Linux. */
export const tag = (p: Profile) => (p.letter ? `${p.letter}:` : `~/SkyPort/${p.label}`);
/** A drive's name in lists: "Work (O:)" on Windows, "Work" elsewhere. */
export const driveName = (p: Profile) => (p.letter ? `${p.label} (${p.letter}:)` : p.label);

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const accountName = (s: Settings, id: string) => s.accountNames[id] ?? id;
export const timeAgo = (unix: number) => {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(unix * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
