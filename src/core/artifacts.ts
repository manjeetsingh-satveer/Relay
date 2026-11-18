export interface ExtractedFile {
  name: string;
  text: string;
}

const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g;
const LANGUAGE_ONLY = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "js",
  "javascript",
  "ts",
  "typescript",
  "tsx",
  "jsx",
  "json",
  "html",
  "css",
  "py",
  "python",
  "text",
  "txt",
  "markdown",
  "md",
  "yaml",
  "yml",
  "xml",
  "sql",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "diff",
  "",
]);

export function extractFencedFiles(text: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  for (const match of text.matchAll(FENCE)) {
    const info = (match[1] ?? "").trim();
    const body = match[2] ?? "";
    const name = filenameFromFence(info);
    if (!name) continue;
    files.push({ name, text: body.replace(/\n$/, "") });
  }
  return files;
}

function filenameFromFence(info: string): string | null {
  const token = info.split(/\s+/)[0] ?? "";
  if (!token || LANGUAGE_ONLY.has(token.toLowerCase())) return null;
  if (token.includes("..") || token.startsWith("/") || token.includes("\\")) return null;
  if (!/^[\w./-]+\.[A-Za-z0-9]+$/.test(token)) return null;
  return token;
}

export function mediaTypeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "html" || ext === "htm") return "text/html";
  if (ext === "css") return "text/css";
  if (ext === "js" || ext === "mjs") return "text/javascript";
  if (ext === "json") return "application/json";
  if (ext === "md") return "text/markdown";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "png") return "image/png";
  return "text/plain";
}

export function safeArtifactName(name: string): string {
  const base = name.split("/").pop() ?? "file.txt";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned : "file.txt";
}
