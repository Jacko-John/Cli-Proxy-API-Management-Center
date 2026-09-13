import type {
  UsageNotificationPeriod,
  UsageNotificationSettings,
  UsageSubscription,
} from '@/services/api/notifications';

export const notificationTimezone = (
  settings: Pick<UsageNotificationSettings, 'configured' | 'timezone'>,
  localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
): string => (settings.configured === false && localTimezone ? localTimezone : settings.timezone);

export const maskNotificationKey = (key: string): string =>
  key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '••••';

export const notificationCost = (period: UsageNotificationPeriod): string =>
  period.requests > 0 && period.unpriced_requests === period.requests
    ? '—'
    : `$${period.cost.toFixed(4)}`;

export const notificationTime = (unix: number, timezone: string, locale: string): string => {
  if (unix <= 0) return '—';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(unix * 1000));
  } catch {
    // 时区输入尚未完成时仍允许编辑，由保存接口校验。
    return '—';
  }
};

export const emptySubscription = (): UsageSubscription => ({
  id: '',
  api_key: '',
  key_label: '',
  email: '',
  note: '',
  enabled: true,
  deleted: false,
});
