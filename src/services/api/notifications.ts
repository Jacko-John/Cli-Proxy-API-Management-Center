import { usagePluginClient, USAGE_PLUGIN_API_BASE } from './usagePluginClient';

export interface UsageNotificationSettings {
  configured?: boolean;
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  weekday: number;
  hour: number;
  minute: number;
  timezone: string;
  sender: string;
  password_configured: boolean;
  next_at: number;
}

export interface UsageSubscription {
  id: string;
  api_key: string;
  key_label: string;
  email: string;
  note: string;
  enabled: boolean;
  deleted: boolean;
}

export interface UsageNotificationPeriod {
  id: string;
  start: number;
  end: number;
  timezone: string;
  email: string;
  key_label: string;
  note: string;
  partial: boolean;
  status: 'open' | 'pending' | 'sending' | 'sent' | 'failed' | 'unknown' | 'skipped' | 'cancelled';
  requests: number;
  tokens: number;
  cost: number;
  unpriced_requests: number;
  attempts: number;
  retry_at: number;
  error: string;
  skipped_cycles: number;
}

export interface UsageNotificationHistory {
  current: UsageNotificationPeriod[];
  periods: UsageNotificationPeriod[];
}

const base = `${USAGE_PLUGIN_API_BASE}/notifications`;
export const usageNotificationsApi = {
  settings: () => usagePluginClient.get<UsageNotificationSettings>(`${base}/settings`),
  saveSettings: (settings: UsageNotificationSettings, password: string, clearPassword: boolean) =>
    usagePluginClient.put<UsageNotificationSettings>(`${base}/settings`, {
      ...settings,
      password,
      clear_password: clearPassword,
    }),
  subscriptions: () =>
    usagePluginClient.get<{ subscriptions: UsageSubscription[] }>(`${base}/subscriptions`),
  saveSubscription: (subscription: UsageSubscription) =>
    subscription.id
      ? usagePluginClient.patch<{ id: string }>(`${base}/subscriptions`, subscription)
      : usagePluginClient.post<{ id: string }>(`${base}/subscriptions`, subscription),
  removeSubscription: (id: string) =>
    usagePluginClient.delete(`${base}/subscriptions`, { data: { id } }),
  history: (id: string) =>
    usagePluginClient.post<UsageNotificationHistory>(`${base}/history`, { id }),
  retry: (id: string) => usagePluginClient.post(`${base}/retry`, { id }),
  testEmail: (email: string) =>
    usagePluginClient.post(`${base}/test-email`, { email }, { timeout: 35000 }),
};
