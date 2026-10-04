/** Formatting helpers for the UI. */

/** Seconds -> "mm:ss.cs" or "hh:mm:ss" depending on length. */
export function formatTime(seconds: number, showCentis = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return showCentis ? `${pad(m)}:${pad(s)}.${pad(cs)}` : `${pad(m)}:${pad(s)}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  return formatTime(seconds, false);
}
