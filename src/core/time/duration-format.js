export function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return "0s";
  }

  const normalizedMs = Math.max(0, Math.floor(durationMs));
  if (normalizedMs === 0) {
    // Exact zero and any positive sub-millisecond input both floor to 0 and render as 0s.
    return "0s";
  }

  if (normalizedMs < 1_000) {
    return `${normalizedMs}ms`;
  }

  const totalSeconds = Math.floor(normalizedMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}
