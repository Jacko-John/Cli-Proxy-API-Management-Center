import { describe, expect, test } from 'bun:test';
import {
  emptySubscription,
  maskNotificationKey,
  notificationCost,
  notificationTime,
  notificationTimezone,
} from '../src/features/notifications/logic';
import type { UsageNotificationPeriod } from '../src/services/api/notifications';

const period: UsageNotificationPeriod = {
  id: '1',
  start: 1789131600,
  end: 1789218000,
  timezone: 'UTC',
  email: 'test@example.com',
  key_label: 'test…1234',
  note: '',
  partial: false,
  status: 'sent',
  requests: 2,
  tokens: 100,
  cost: 12.345678,
  unpriced_requests: 0,
  attempts: 1,
  retry_at: 0,
  error: '',
  skipped_cycles: 0,
};

describe('notification time zone defaults', () => {
  test('uses the browser time zone before the first settings save', () => {
    expect(
      notificationTimezone({ configured: false, timezone: 'Asia/Shanghai' }, 'America/New_York')
    ).toBe('America/New_York');
  });
  test('reads the current browser time zone automatically', () => {
    expect(notificationTimezone({ configured: false, timezone: 'UTC' })).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  });
  test('preserves a saved time zone when another browser opens the page', () => {
    expect(notificationTimezone({ configured: true, timezone: 'Europe/Paris' }, 'Asia/Tokyo')).toBe(
      'Europe/Paris'
    );
  });
  test('preserves settings from a plugin without the configuration flag', () => {
    expect(notificationTimezone({ timezone: 'UTC' }, 'Asia/Tokyo')).toBe('UTC');
  });
  test('keeps the server default if no local time zone is available', () => {
    expect(notificationTimezone({ configured: false, timezone: 'Asia/Shanghai' }, '')).toBe(
      'Asia/Shanghai'
    );
  });
});

describe('usage notification display', () => {
  test('does not display the full key', () => {
    expect(maskNotificationKey('secret-key-1234')).toBe('secr…1234');
    expect(maskNotificationKey('short')).toBe('••••');
  });
  test('distinguishes unpriced requests from real zero usage', () => {
    expect(notificationCost(period)).toBe('$12.3457');
    expect(notificationCost({ ...period, unpriced_requests: 2 })).toBe('—');
    expect(notificationCost({ ...period, requests: 0, cost: 0 })).toBe('$0.0000');
  });
  test('formats minute precision using the cycle timezone', () => {
    expect(notificationTime(1789128000, 'Asia/Shanghai', 'zh-CN')).toContain('20:00');
    expect(notificationTime(1789128000, 'UTC', 'zh-CN')).toContain('12:00');
    expect(notificationTime(1789128000, 'Asia/', 'zh-CN')).toBe('—');
    expect(notificationTime(0, 'UTC', 'zh-CN')).toBe('—');
  });
  test('each new binding starts with a fresh empty draft', () => {
    const first = emptySubscription();
    first.email = 'one@example.com';
    expect(emptySubscription().email).toBe('');
    expect(emptySubscription().enabled).toBe(true);
  });
});
