import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { buildCodexQuotaWindows } from '@/features/quota/providers/codex/data';
import type { CodexUsagePayload } from '@/types';
import { parseCodexUsagePayload } from '@/utils/quota';

const t = ((key: string) => key) as TFunction;

const USAGE_PAYLOAD: CodexUsagePayload = {
  plan_type: 'pro',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 1,
      limit_window_seconds: 604800,
      reset_after_seconds: 601888,
      reset_at: 1785902974,
    },
    secondary_window: null,
  },
  code_review_rate_limit: null,
  additional_rate_limits: [
    {
      limit_name: 'GPT-5.3-Codex-Spark',
      metered_feature: 'codex_bengalfox',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 0,
          limit_window_seconds: 604800,
          reset_after_seconds: 602111,
          reset_at: 1785903197,
        },
        secondary_window: null,
      },
    },
  ],
  rate_limit_reset_credits: null,
};

describe('Codex quota metadata', () => {
  test('preserves reset timestamps and window durations', () => {
    const payload = parseCodexUsagePayload(JSON.stringify(USAGE_PAYLOAD));
    expect(payload).not.toBeNull();

    const windows = buildCodexQuotaWindows(payload!, t);
    expect(windows.map(({ resetAtMs }) => resetAtMs)).toEqual([
      1_785_902_974_000, 1_785_903_197_000,
    ]);
    expect(windows.map(({ periodHours }) => periodHours)).toEqual([168, 168]);
  });
});
