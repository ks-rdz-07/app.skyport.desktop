// File-type icons: Lucide's file shapes (ISC licence), each in its type's colour, so the shape and
// the colour both tell types apart at list size. Generic shapes only; no other company's logo.
import { File, FileArchive, FileAudio, FileCode, FileCog, FileImage, FileSpreadsheet, FileText, FileVideo, type LucideIcon, Presentation } from "lucide-react";

type Kind = { name: string; icon: LucideIcon; color: string };

const KINDS: [string[], Kind][] = [
  [["pdf"], { name: "PDF document", icon: FileText, color: "#d93025" }],
  [["doc", "docx", "odt", "rtf"], { name: "Document", icon: FileText, color: "#2b6cd6" }],
  [["xls", "xlsx", "ods", "csv"], { name: "Spreadsheet", icon: FileSpreadsheet, color: "#1f8a4c" }],
  [["ppt", "pptx", "odp", "key"], { name: "Presentation", icon: Presentation, color: "#c4560f" }],
  [["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "tif", "tiff", "svg", "raw"], { name: "Image", icon: FileImage, color: "#138d90" }],
  [["mp4", "mov", "mkv", "avi", "wmv", "webm"], { name: "Video", icon: FileVideo, color: "#c2255c" }],
  [["mp3", "wav", "flac", "m4a", "aac", "ogg"], { name: "Audio", icon: FileAudio, color: "#0b7285" }],
  [["zip", "rar", "7z", "tar", "gz", "iso"], { name: "Archive", icon: FileArchive, color: "#a8730a" }],
  [["txt", "md", "log"], { name: "Text", icon: FileText, color: "#5f636a" }],
  [["js", "ts", "tsx", "py", "rs", "json", "html", "css", "xml", "yml", "yaml", "sql", "sh", "ps1"], { name: "Code", icon: FileCode, color: "#3d4451" }],
  [["exe", "msi", "bat", "cmd"], { name: "Program", icon: FileCog, color: "#3d4451" }],
];

export function kindOf(name: string): Kind {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  for (const [exts, k] of KINDS) if (exts.includes(ext)) return k;
  return { name: ext ? `${ext.toUpperCase()} file` : "File", icon: File, color: "#6b6f76" };
}

export function FileIcon({ name, size = 18 }: { name: string; size?: number }) {
  const k = kindOf(name);
  const C = k.icon;
  return <C className="file-icon" size={size} color={k.color} strokeWidth={1.75} role="img" aria-label={k.name} />;
}
