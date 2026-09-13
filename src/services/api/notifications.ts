import { apiClient } from './client';

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

const base = '/plugins/usage-statistics/notifications';
export const usageNotificationsApi = {
  settings: () => apiClient.get<UsageNotificationSettings>(`${base}/settings`),
  saveSettings: (settings: UsageNotificationSettings, password: string, clearPassword: boolean) =>
    apiClient.put<UsageNotificationSettings>(`${base}/settings`, {
      ...settings,
      password,
      clear_password: clearPassword,
    }),
  subscriptions: () =>
    apiClient.get<{ subscriptions: UsageSubscription[] }>(`${base}/subscriptions`),
  saveSubscription: (subscription: UsageSubscription) =>
    subscription.id
      ? apiClient.patch<{ id: string }>(`${base}/subscriptions`, subscription)
      : apiClient.post<{ id: string }>(`${base}/subscriptions`, subscription),
  removeSubscription: (id: string) => apiClient.delete(`${base}/subscriptions`, { data: { id } }),
  history: (id: string) => apiClient.post<UsageNotificationHistory>(`${base}/history`, { id }),
  retry: (id: string) => apiClient.post(`${base}/retry`, { id }),
  testEmail: (email: string) => apiClient.post(`${base}/test-email`, { email }, { timeout: 35000 }),
};
