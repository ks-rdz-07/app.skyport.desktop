// Dev-only sample data so screens can be previewed and inspected in a browser without the
// Rust backend. Never bundled in production (imported only when import.meta.env.DEV).
import { OS, type Account, type CacheInfo, type Details, type DriveStatus, type Overview, type Profile, type Snapshot } from "@/api";

const GiB = 1024 ** 3;
const TiB = 1024 ** 4;
const now = Math.floor(Date.now() / 1000);

const profiles: Profile[] = [
  { id: "d1", label: "OneDrive", remote: "personal", path: "", letter: OS === "windows" ? "O" : "", readOnly: false },
  { id: "d2", label: "Projects", remote: "work", path: "Projects", letter: OS === "windows" ? "P" : "", readOnly: false },
  { id: "d3", label: "Archive", remote: "work", path: "Archive/2025", letter: OS === "windows" ? "R" : "", readOnly: true },
];
const accountNames: Record<string, string> = { personal: "Personal", work: "Work" };
const kinds: Record<string, string> = { personal: "OneDrive Personal", work: "OneDrive for Business" };

// Storage per account, with 30 daily readings that end at today's value.
const quotaNow: Record<string, Snapshot> = {
  personal: { at: now - 120, total: Math.round(1.117 * TiB), used: Math.round(10.7 * GiB), free: 0, trashed: Math.round(0.4 * GiB) },
  work: { at: now - 120, total: TiB, used: Math.round(412.3 * GiB), free: 0, trashed: Math.round(6.1 * GiB) },
};
for (const q of Object.values(quotaNow)) q.free = q.total! - q.used!;
const history = (acct: string, start: number): Snapshot[] =>
  Array.from({ length: 30 }, (_, i) => {
    const q = quotaNow[acct];
    const used = i === 29 ? q.used! : Math.round(start + ((q.used! - start) * i) / 29 + (i % 4 === 0 ? 0.3 * GiB : 0));
    return { ...q, at: q.at - (29 - i) * 86400, used, free: q.total! - used };
  });

const statuses: DriveStatus[] = [
  { id: "d1", state: "connected", error: null, uploading: 0, queued: 0, failed: 0 },
  { id: "d2", state: "connected", error: null, uploading: 1, queued: 2, failed: 0 },
  { id: "d3", state: "stopped", error: null, uploading: 0, queued: 0, failed: 0 },
];
const cachePerAccount: Record<string, number> = { personal: Math.round(0.21 * GiB), work: Math.round(1.36 * GiB) };
const cache: CacheInfo = { bytes: Object.values(cachePerAccount).reduce((a, b) => a + b, 0), waiting: { d1: 0, d2: 3, d3: 0 } };

// Facts shown twice must agree.
console.assert(statuses[1].uploading + statuses[1].queued === cache.waiting.d2, "uploads in progress match the cache");
for (const q of Object.values(quotaNow)) console.assert(q.used! + q.free! === q.total!, "used + free = total");

const accounts = (): Account[] =>
  Object.keys(accountNames).map((id) => ({
    id,
    name: accountNames[id],
    kind: kinds[id],
    drives: profiles.filter((p) => p.remote === id).map((p) => `${p.label} (${p.letter}:)`),
  }));

const overview = (): Overview => ({
  engineVersion: "v1.76.0",
  driver: true,
  elevated: false,
  settings: { cacheDir: "E:\\CloudDriveCache", autoMount: true, profiles, accountNames, connected: ["d1", "d2"] } as Overview["settings"],
  usedLetters: ["C", "D", "E", "O", "P"],
  computer: "DESKTOP-7Q2K",
  user: "Customer",
  scanner: OS === "windows" ? "Microsoft Defender" : "ClamAV",
  platform: OS,
  mountRoot: OS === "windows" ? "" : "/Users/customer/SkyPort",
  defaultCacheDir: "C:\\Users\\Customer\\AppData\\Local\\app.skyport.desktop\\cache",
});

const details = (id: string): Details => {
  const p = profiles.find((x) => x.id === id)!;
  return {
    profile: p,
    account: accounts().find((a) => a.id === p.remote)!,
    quota: quotaNow[p.remote],
    quotaError: null,
    history: history(p.remote, p.remote === "work" ? 371.8 * GiB : 9.1 * GiB),
    events: [
      { at: now - 1500, kind: "connected", detail: "Drive connected" },
      { at: now - 86400 - 3200, kind: "disconnected", detail: "Drive disconnected" },
      { at: now - 2 * 86400, kind: "error", detail: "Can't reach OneDrive right now. Check your internet connection and try again." },
      { at: now - 2 * 86400 + 900, kind: "connected", detail: "Drive connected" },
    ],
    cacheDir: "E:\\CloudDriveCache",
    cacheBytes: cachePerAccount[p.remote],
    waiting: cache.waiting[id] ?? 0,
    pc: { computer: "DESKTOP-7Q2K", user: "Customer", localIp: "192.168.1.24" },
  };
};

export async function mock(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 60));
  switch (cmd) {
    case "overview": return overview();
    case "status": return statuses;
    case "cache_info": return cache;
    case "accounts": return accounts();
    case "quota": return quotaNow[args.account as string];
    case "details": return details(args.id as string);
    case "activity":
      return [
        { id: "d1", speed: 0, transferred: 0, errors: 0, transfers: [], queue: [] },
        { id: "d2", speed: 1.8 * 1024 * 1024, transferred: Math.round(96.4 * 1024 * 1024), errors: 0,
          transfers: [{ name: "Clients/Site survey/North elevation.tif", size: Math.round(184.2 * 1024 * 1024), bytes: Math.round(96.4 * 1024 * 1024), percent: 52, speed: 1.8 * 1024 * 1024, eta: 49 }],
          queue: [
            { name: "Clients/Site survey/North elevation.tif", size: Math.round(184.2 * 1024 * 1024), tries: 0, uploading: true },
            { name: "Clients/Site survey/South elevation.tif", size: Math.round(171.9 * 1024 * 1024), tries: 0, uploading: false },
            { name: "Invoices/2026-11 Hartley & Sons.pdf", size: Math.round(0.3 * 1024 * 1024), tries: 1, uploading: false },
          ] },
      ];
    case "logs": {
      const t = (m: number) => new Date(Date.now() - m * 60000).toISOString().replace("T", " ").slice(0, 19).replace(/-/g, "/");
      return [
        `${t(42)} NOTICE: Serving remote control on http://127.0.0.1:53580/`,
        `${t(42)} INFO  : The service engine has been started.`,
        `${t(18)} INFO  : Clients/Site survey/North elevation.tif: vfs cache: queuing for upload in 5s`,
        `${t(18)} INFO  : Invoices/2026-11 Hartley & Sons.pdf: vfs cache: queuing for upload in 5s`,
        `${t(17)} ERROR : Invoices/2026-11 Hartley & Sons.pdf: Failed to copy: couldn't connect: dial tcp: i/o timeout`,
        `${t(17)} INFO  : Invoices/2026-11 Hartley & Sons.pdf: vfs cache: upload failed, retry 1 in 10s`,
        `${t(2)} INFO  : Clients/Site survey/North elevation.tif: Multi-thread upload started`,
      ];
    }
    case "scan_item": await new Promise((r) => setTimeout(r, 900)); return { engine: "Microsoft Defender", clean: true, detail: "No threats found." };
    case "rename_item": return String(args.name);
    case "browse": {
      const d = (n: string, days: number) => ({ name: n, isDir: true, size: -1, modified: new Date((now - days * 86400) * 1000).toISOString() });
      const f = (n: string, mb: number, days: number) => ({ name: n, isDir: false, size: Math.round(mb * 1024 * 1024), modified: new Date((now - days * 86400) * 1000).toISOString() });
      return args.path ? [f("Brief.docx", 0.08, 1), f("Budget 2026.xlsx", 0.42, 3), f("Site photos.zip", 312.5, 12)]
        : [d("Clients", 2), d("Invoices", 5), d("Photos", 30), f("Contract - signed.pdf", 1.9, 0), f("Notes.txt", 0.004, 6), f("Roadmap.pptx", 6.3, 9)];
    }
    case "list_folders": return ["Archive", "Clients", "Invoices", "Photos", "Projects"];
    case "twofa_status": return { enabled: false, locked: false, recoveryLeft: 0 };
    default: return null;
  }
}
