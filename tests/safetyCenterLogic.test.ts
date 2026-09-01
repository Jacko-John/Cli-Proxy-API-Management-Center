import { describe, expect, test } from 'bun:test';
import type { SafetyHistoryItem, SafetyKeyStatus } from '../src/types/usageSafety';
import {
  formatSafetyFailureBody,
  historyCursor,
  sortSafetyKeys,
  summarizeSafetyKeys,
} from '../src/features/safety/logic';

const safetyKey = (overrides: Partial<SafetyKeyStatus>): SafetyKeyStatus => ({
  api_key: 'key',
  total_trigger_count: 0,
  window_trigger_count: 0,
  total_limit_count: 0,
  manual_disabled: false,
  blocked: false,
  blocked_until: 0,
  ...overrides,
});

const historyItem = (overrides: Partial<SafetyHistoryItem>): SafetyHistoryItem => ({
  api_key: 'key',
  occurred_at: 1,
  usage_record_id: 'record',
  blocked_until: 0,
  manual_released_at: 0,
  provider: 'codex',
  model: 'gpt-5-codex',
  failure_status_code: 400,
  failure_body: null,
  status: 'not_limited',
  ...overrides,
});

describe('safety center logic', () => {
  test('sorts manually disabled keys before active limits and recent activity', () => {
    const sorted = sortSafetyKeys([
      safetyKey({ api_key: 'quiet', total_trigger_count: 10 }),
      safetyKey({ api_key: 'recent', window_trigger_count: 3 }),
      safetyKey({ api_key: 'blocked', blocked: true, window_trigger_count: 1 }),
      safetyKey({ api_key: 'disabled', manual_disabled: true }),
    ]);

    expect(sorted.map((item) => item.api_key)).toEqual(['disabled', 'blocked', 'recent', 'quiet']);
  });

  test('summarizes counters without changing key data', () => {
    const keys = [
      safetyKey({
        blocked: true,
        manual_disabled: true,
        total_trigger_count: 5,
        total_limit_count: 2,
      }),
      safetyKey({ api_key: 'second', total_trigger_count: 3, total_limit_count: 1 }),
    ];

    expect(summarizeSafetyKeys(keys)).toEqual({
      keys: 2,
      disabledKeys: 1,
      activeLimits: 1,
      totalTriggers: 8,
      totalLimits: 3,
    });
  });

  test('renders structured failure bodies as readable JSON', () => {
    expect(formatSafetyFailureBody({ error: { code: 'cyber_policy' } })).toBe(
      '{\n  "error": {\n    "code": "cyber_policy"\n  }\n}'
    );
    expect(formatSafetyFailureBody('plain text')).toBe('plain text');
    expect(formatSafetyFailureBody(null)).toBe('');
  });

  test('uses the final history row as the composite pagination cursor', () => {
    const history = [
      historyItem({ occurred_at: 20, usage_record_id: 'newer' }),
      historyItem({ occurred_at: 10, usage_record_id: 'older' }),
    ];

    expect(historyCursor(history)).toEqual({ before_time: 10, before_id: 'older' });
    expect(historyCursor([])).toBeUndefined();
  });
});
