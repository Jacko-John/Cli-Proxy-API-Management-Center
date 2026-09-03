import type { AntigravityQuotaBucket } from '@/types';
import { HOUR_MS } from '@/utils/time/durations';

const DEFAULT_WINDOW_MS = 7 * 24 * HOUR_MS;
const WINDOW_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: HOUR_MS,
  d: 24 * HOUR_MS,
  w: 7 * 24 * HOUR_MS,
};

export const getAntigravityWindowDurationMs = (
  bucket: AntigravityQuotaBucket | null
): number | null => {
  if (!bucket) return null;
  if (
    typeof bucket.periodHours === 'number' &&
    Number.isFinite(bucket.periodHours) &&
    bucket.periodHours > 0
  ) {
    return bucket.periodHours * HOUR_MS;
  }

  const normalized = bucket.window?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('week')) return 7 * 24 * HOUR_MS;
  if (normalized.includes('month')) return 30 * 24 * HOUR_MS;
  if (normalized.includes('day') || normalized.includes('dai')) return 24 * HOUR_MS;
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*([smhdw])/);
  if (!match) return null;

  const value = Number(match[1]);
  const unitMs = WINDOW_UNIT_MS[match[2]];
  return Number.isFinite(value) && unitMs ? value * unitMs : null;
};

export const getAntigravityCredentialWindowRange = (
  bucket: AntigravityQuotaBucket | null
): { start: number; end: number } | null => {
  if (!bucket) return null;

  const resetAtMs =
    typeof bucket.resetAtMs === 'number' &&
    Number.isFinite(bucket.resetAtMs) &&
    bucket.resetAtMs > 0
      ? bucket.resetAtMs
      : Date.parse(bucket.resetTime ?? '');
  if (!Number.isFinite(resetAtMs) || resetAtMs <= 0) return null;

  const durationMs = getAntigravityWindowDurationMs(bucket) ?? DEFAULT_WINDOW_MS;
  return {
    start: Math.floor((resetAtMs - durationMs) / 1000),
    end: Math.floor(resetAtMs / 1000),
  };
};
