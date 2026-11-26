// On macOS and Linux, the interface's Windows words are swapped for that system's words as they
// render (text and the title / aria-label / data-tip / placeholder attributes). Windows is untouched.
// shortcut: wording swapped at render time; move to per-string translations if SkyPort is localized.
import { FM, FMS, HERE, HERE_CAP, OS, OSNAME } from "@/api";

const KEYSTORE = OS === "macos" ? "the Keychain" : "the system keyring";

// Ordered: longer phrases first so "File Explorer" is never half-replaced by the "Explorer" rule.
const RULES: [RegExp, string][] = [
  [/\b(in|from) This PC\b/g, `$1 ${FM}`],
  [/File Explorer/g, FM],
  [/\bExplorer\b/g, FMS],
  [/\bThis PC\b/g, HERE_CAP],
  [/\bthis PC\b/g, HERE],
  [/\bPC details\b/g, "computer details"],
  [/\byour Windows account\b/g, "your user account"],
  [/\bStart with Windows\b/g, "Start at login"],
  [/\bstarts with Windows\b/g, "starts at login"],
  [/\bstart SkyPort with Windows\b/g, "start SkyPort at login"],
  [/\bprotected by Windows\b/g, `protected by ${KEYSTORE}`],
  [/\bsign in to Windows\b/g, "log in"],
  [/\bWindows user\b/g, "User"],
  [/\bWindows\b/g, OSNAME],
  [/\bdrive letter in\b/g, "folder in"],
  [/\ba real drive letter\b/g, "a folder you can open like any other"],
  [/\bpick a letter\b/g, "give it a name"],
];

const ATTRS = ["title", "aria-label", "data-tip", "placeholder"];

const swap = (s: string) => RULES.reduce((t, [re, to]) => t.replace(re, to), s);

function fix(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const v = node.nodeValue ?? "";
    const n = swap(v);
    if (n !== v) node.nodeValue = n;
    return;
  }
  if (!(node instanceof Element)) return;
  for (const a of ATTRS) {
    const v = node.getAttribute(a);
    if (v) {
      const n = swap(v);
      if (n !== v) node.setAttribute(a, n);
    }
  }
  if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") return; // never touch what people type
  node.childNodes.forEach(fix);
}

export function startOsText() {
  if (OS === "windows") return;
  fix(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") fix(r.target);
      else if (r.type === "attributes") fix(r.target);
      else r.addedNodes.forEach(fix);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  document.title = swap(document.title);
}
