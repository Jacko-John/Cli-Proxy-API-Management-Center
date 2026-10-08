import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { NotificationUsageDetails } from '../src/features/notifications/NotificationUsageDetails';
import { NotificationPeriods } from '../src/features/notifications/NotificationPeriods';
import { notificationTranslations } from '../src/i18n/notificationTranslations';
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
    expect(notificationCost({ requests: 1, cost: 0.000123, unpriced_requests: 0 }, 6)).toBe(
      '$0.000123'
    );
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

const details: NonNullable<UsageNotificationPeriod['details']> = [
  {
    model: 'model-a',
    service_tier: 'default',
    requests: 2,
    tokens: 1234,
    cost: 1.2,
    unpriced_requests: 0,
  },
  {
    model: 'model-a',
    service_tier: 'priority',
    requests: 1,
    tokens: 45,
    cost: 0.000123,
    unpriced_requests: 0,
  },
  { model: 'free-model', service_tier: '', requests: 1, tokens: 10, cost: 0, unpriced_requests: 0 },
  {
    model: 'unpriced-model',
    service_tier: 'flex',
    requests: 1,
    tokens: 20,
    cost: 0,
    unpriced_requests: 1,
  },
];

async function renderNotification(element: ReturnType<typeof createElement>, locale = 'en') {
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    resources: Object.fromEntries(
      Object.entries(notificationTranslations).map(([language, usage_notifications]) => [
        language,
        { translation: { usage_notifications } },
      ])
    ),
  });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
}

describe('usage notification breakdown', () => {
  test('shows separate tier costs, small charges, unpriced usage and unreported tiers', async () => {
    const markup = await renderNotification(
      createElement(NotificationUsageDetails, { period: { ...period, details, status: 'open' } })
    );
    for (const value of [
      'Model',
      'Service tier',
      'Cost (USD)',
      'default',
      'priority',
      '$1.200000',
      '$0.000123',
      'Not reported',
      '1 unpriced requests; cost is incomplete',
      '1,234',
    ]) {
      expect(markup).toContain(value);
    }
    expect(markup.match(/>model-a</g)).toHaveLength(2);
    expect(markup.match(/\$0\.000000/g)).toHaveLength(1);
    expect(markup).toMatch(/<details[^>]* open=""/);
    expect(markup).toContain('scope="col"');
    expect(markup).toContain('aria-label="Usage details"');
  });

  test('distinguishes legacy snapshots from a recorded empty cycle', async () => {
    for (const value of [undefined, null]) {
      const markup = await renderNotification(
        createElement(NotificationUsageDetails, { period: { ...period, details: value } })
      );
      expect(markup).toContain('No breakdown was saved for this cycle');
      expect(markup).not.toContain('No usage in this cycle');
      expect(markup).not.toMatch(/<details[^>]* open=/);
    }
    const empty = await renderNotification(
      createElement(NotificationUsageDetails, { period: { ...period, details: [] } })
    );
    expect(empty).toContain('No usage in this cycle');
    expect(empty).not.toContain('No breakdown was saved');
  });

  test('escapes model and tier text in the rendered breakdown', async () => {
    const markup = await renderNotification(
      createElement(NotificationUsageDetails, {
        period: {
          ...period,
          details: [
            { ...details[0], model: '<script>model</script>', service_tier: '<img src=x>' },
          ],
        },
      })
    );
    expect(markup).toContain('&lt;script&gt;model&lt;/script&gt;');
    expect(markup).toContain('&lt;img src=x&gt;');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<img');
  });

  test('localizes detail labels and notices in all four languages', async () => {
    for (const [locale, labels] of Object.entries(notificationTranslations)) {
      const markup = await renderNotification(
        createElement(NotificationUsageDetails, { period: { ...period, details } }),
        locale
      );
      for (const label of [
        labels.details,
        labels.model,
        labels.service_tier,
        labels.tier_unreported,
      ]) {
        expect(markup).toContain(label);
      }
      expect(markup).not.toContain('usage_notifications.');
    }
  });

  test('keeps breakdowns attached to their cycles and preserves retry controls', async () => {
    const markup = await renderNotification(
      createElement(NotificationPeriods, {
        items: [
          { ...period, details, status: 'failed' },
          { ...period, id: '2', details: [] },
        ],
        busy: true,
        onRetry: () => {},
      })
    );
    expect(markup.match(/<details\b/g)).toHaveLength(2);
    expect(markup).toContain('colSpan="6"');
    expect(markup.match(/<button /g)).toHaveLength(1);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Retry');
  });
});
