// Build guard: every static class name used in the components must be defined in styles.css.
// Catches a stylesheet section going missing (it happened once with the splash) before it ships.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync("src/styles.css", "utf8");
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
// Classes that exist only as JS hooks or state names, styled through a parent selector or not at all.
const allow = new Set(["state-stopped", "ok", "warn", "idle", "logo", "ring", "track", "arc", "two", "selected", "lv-info", "lv-notice", "lv-error", "lv-debug", "ev-connected", "ev-disconnected", "ev-error", "up", "file-actions"]);

const files = readdirSync("src", { recursive: true }).filter((f) => f.endsWith(".tsx")).map((f) => join("src", f));
const missing = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/className="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c && !defined.has(c) && !allow.has(c)) missing.push(`${f}: .${c}`);
  }
}
if (missing.length) {
  console.error(`check-classes: ${missing.length} class name(s) used but not defined in src/styles.css:\n  ` + [...new Set(missing)].join("\n  "));
  process.exit(1);
}
console.log(`check-classes: ok (${files.length} files)`);
