import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import {
  usageNotificationsApi,
  type UsageNotificationSettings,
  type UsageSubscription,
} from '../src/services/api/notifications';

const originalMethods = {
  get: apiClient.get,
  post: apiClient.post,
  put: apiClient.put,
  patch: apiClient.patch,
  delete: apiClient.delete,
};

afterEach(() => {
  Object.assign(apiClient, originalMethods);
});

const settings: UsageNotificationSettings = {
  enabled: true,
  frequency: 'weekly',
  weekday: 1,
  hour: 9,
  minute: 30,
  timezone: 'Asia/Singapore',
  sender: 'sender@example.com',
  password_configured: false,
  next_at: 0,
};

const subscription: UsageSubscription = {
  id: 'subscription-1',
  api_key: 'fixture-only',
  key_label: 'fixt…only',
  email: 'subscriber@example.com',
  note: 'Weekly usage',
  enabled: true,
  deleted: false,
};

const cases = [
  { run: () => usageNotificationsApi.settings(), method: 'get', path: 'settings' },
  {
    run: () => usageNotificationsApi.saveSettings(settings, 'fixture-password', false),
    method: 'put',
    path: 'settings',
    data: { ...settings, password: 'fixture-password', clear_password: false },
  },
  { run: () => usageNotificationsApi.subscriptions(), method: 'get', path: 'subscriptions' },
  {
    run: () => usageNotificationsApi.saveSubscription({ ...subscription, id: '' }),
    method: 'post',
    path: 'subscriptions',
    data: { ...subscription, id: '' },
  },
  {
    run: () => usageNotificationsApi.saveSubscription(subscription),
    method: 'patch',
    path: 'subscriptions',
    data: subscription,
  },
  {
    run: () => usageNotificationsApi.removeSubscription(subscription.id),
    method: 'delete',
    path: 'subscriptions',
    data: { id: subscription.id },
  },
  {
    run: () => usageNotificationsApi.history(subscription.id),
    method: 'post',
    path: 'history',
    data: { id: subscription.id },
  },
  {
    run: () => usageNotificationsApi.retry('period-1'),
    method: 'post',
    path: 'retry',
    data: { id: 'period-1' },
  },
  {
    run: () => usageNotificationsApi.testEmail(subscription.email),
    method: 'post',
    path: 'test-email',
    data: { email: subscription.email },
    timeout: 35_000,
  },
];

describe('usage notification API', () => {
  test.each(cases)('uses the plugin route for $method $path', async (entry) => {
    const requests: Array<{
      method: string;
      url: string;
      data: unknown;
      timeout?: number;
    }> = [];
    apiClient.get = (async (url, config) => {
      requests.push({ method: 'get', url, data: undefined, timeout: config?.timeout });
      return {};
    }) as typeof apiClient.get;
    apiClient.delete = (async (url, config) => {
      requests.push({ method: 'delete', url, data: config?.data, timeout: config?.timeout });
      return {};
    }) as typeof apiClient.delete;
    for (const method of ['post', 'put', 'patch'] as const) {
      apiClient[method] = (async (url, data, config) => {
        requests.push({ method, url, data, timeout: config?.timeout });
        return {};
      }) as typeof apiClient.post;
    }

    await entry.run();

    expect(requests).toEqual([
      {
        method: entry.method,
        url: `/v0/management/plugins/usage-statistics/notifications/${entry.path}`,
        data: entry.data,
        timeout: entry.timeout,
      },
    ]);
  });
});
