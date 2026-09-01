import type { SafetyHistoryItem, SafetyKeyStatus } from '@/types/usageSafety';

export interface SafetySummary {
  keys: number;
  disabledKeys: number;
  activeLimits: number;
  totalTriggers: number;
  totalLimits: number;
}

export const sortSafetyKeys = (keys: SafetyKeyStatus[]): SafetyKeyStatus[] =>
  [...keys].sort((left, right) => {
    if (left.manual_disabled !== right.manual_disabled) return left.manual_disabled ? -1 : 1;
    if (left.blocked !== right.blocked) return left.blocked ? -1 : 1;
    if (left.window_trigger_count !== right.window_trigger_count) {
      return right.window_trigger_count - left.window_trigger_count;
    }
    if (left.total_trigger_count !== right.total_trigger_count) {
      return right.total_trigger_count - left.total_trigger_count;
    }
    return left.api_key.localeCompare(right.api_key);
  });

export const summarizeSafetyKeys = (keys: SafetyKeyStatus[]): SafetySummary =>
  keys.reduce<SafetySummary>(
    (summary, key) => ({
      keys: summary.keys + 1,
      disabledKeys: summary.disabledKeys + (key.manual_disabled ? 1 : 0),
      activeLimits: summary.activeLimits + (key.blocked ? 1 : 0),
      totalTriggers: summary.totalTriggers + key.total_trigger_count,
      totalLimits: summary.totalLimits + key.total_limit_count,
    }),
    { keys: 0, disabledKeys: 0, activeLimits: 0, totalTriggers: 0, totalLimits: 0 }
  );

export const formatSafetyFailureBody = (body: unknown): string => {
  if (body === null || body === undefined || body === '') return '';
  if (typeof body === 'string') return body;
  return JSON.stringify(body, null, 2) ?? String(body);
};

export const historyCursor = (history: SafetyHistoryItem[]) => {
  const last = history[history.length - 1];
  return last ? { before_time: last.occurred_at, before_id: last.usage_record_id } : undefined;
};
