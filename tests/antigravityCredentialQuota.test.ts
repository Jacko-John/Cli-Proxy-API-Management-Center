import { describe, expect, test } from 'bun:test';
import { getAntigravityCredentialWindowRange } from '../src/fork/antigravityCredentialWindow';
import type { AntigravityQuotaBucket } from '../src/types';
import { DAY_MS, HOUR_MS } from '../src/utils/time/durations';

const RESET_AT_MS = 1_800_000_000_000;

const quotaBucket = (bucket: Partial<AntigravityQuotaBucket>): AntigravityQuotaBucket => ({
  id: 'bucket',
  label: 'Bucket',
  remainingFraction: 0.5,
  resetAtMs: RESET_AT_MS,
  ...bucket,
});

describe('Antigravity credential usage window', () => {
  test('uses the selected five-hour bucket period', () => {
    const range = getAntigravityCredentialWindowRange(
      quotaBucket({ window: '5h', periodHours: 5 })
    );

    expect(range).toEqual({
      start: Math.floor((RESET_AT_MS - 5 * HOUR_MS) / 1000),
      end: Math.floor(RESET_AT_MS / 1000),
    });
  });

  test('falls back to seven days when the bucket period is unknown', () => {
    const range = getAntigravityCredentialWindowRange(
      quotaBucket({ window: 'unknown', periodHours: null })
    );

    expect(range).toEqual({
      start: Math.floor((RESET_AT_MS - 7 * DAY_MS) / 1000),
      end: Math.floor(RESET_AT_MS / 1000),
    });
  });
});
