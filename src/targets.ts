/**
 * KOOK target normalization.
 *
 * Target formats:
 * - channel:<channelId>   — server channel
 * - user:<userId>         — direct message target
 * - <raw id>              — auto-detect
 */

export function normalizeKookTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("channel:")) {
    return trimmed.slice("channel:".length).trim() || null;
  }
  if (lowered.startsWith("user:")) {
    return trimmed.slice("user:".length).trim() || null;
  }

  return trimmed;
}

export function formatKookTarget(id: string, type: "channel" | "user"): string {
  return `${type}:${id}`;
}

export function looksLikeKookId(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^(channel|user):/i.test(trimmed)) return true;
  // KOOK IDs are numeric
  if (/^\d+$/.test(trimmed)) return true;
  return false;
}
