import type { AttachmentKind } from "./types";

export function attachmentKindFromFile(file: File): AttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatRelativeDate(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "Ara mateix";
  if (diff < hour) return `Fa ${Math.floor(diff / minute)} min`;
  if (diff < day) return `Fa ${Math.floor(diff / hour)} h`;
  if (diff < 7 * day) return `Fa ${Math.floor(diff / day)} dies`;
  return new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short", year: "numeric" }).format(timestamp);
}

export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function mediaEmbed(urlValue: string): { type: "youtube" | "spotify" | "image" | "none"; url?: string } {
  const url = safeUrl(urlValue);
  if (!url) return { type: "none" };
  const parsed = new URL(url);

  if (parsed.hostname.includes("youtube.com")) {
    const id = parsed.searchParams.get("v");
    if (id) return { type: "youtube", url: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (parsed.hostname === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    if (id) return { type: "youtube", url: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (parsed.hostname.includes("spotify.com")) {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const index = parts[0] === "intl-es" || parts[0] === "intl-ca" ? 1 : 0;
    const type = parts[index];
    const id = parts[index + 1];
    if (["track", "album", "playlist", "episode", "show"].includes(type) && id) {
      return { type: "spotify", url: `https://open.spotify.com/embed/${type}/${id}` };
    }
  }
  if (/\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(parsed.pathname + parsed.search)) {
    return { type: "image", url };
  }
  return { type: "none" };
}
