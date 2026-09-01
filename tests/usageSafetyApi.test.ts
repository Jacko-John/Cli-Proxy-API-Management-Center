import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { usageSafetyApi } from '../src/services/api/usage';

const originalGet = apiClient.get;
const originalPost = apiClient.post;
const originalDelete = apiClient.delete;

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.post = originalPost;
  apiClient.delete = originalDelete;
});

describe('usage safety API', () => {
  test('loads API key safety state from the plugin route', async () => {
    let request: { url: string; timeout?: number } | undefined;
    apiClient.get = (async (url: string, config) => {
      request = { url, timeout: config?.timeout };
      return { keys: [] };
    }) as typeof apiClient.get;

    await usageSafetyApi.getKeys();

    expect(request).toEqual({
      url: '/plugins/usage-statistics/safety/keys',
      timeout: 60_000,
    });
  });

  test('keeps the full API key in the safety history POST body', async () => {
    let request: { url: string; data: unknown; timeout?: number } | undefined;
    apiClient.post = (async (url: string, data, config) => {
      request = { url, data, timeout: config?.timeout };
      return { history: [] };
    }) as typeof apiClient.post;

    const query = {
      api_key: 'client-secret',
      blocked_only: true,
      before_time: 100,
      before_id: 'record-id',
      limit: 50,
    };
    await usageSafetyApi.getHistory(query);

    expect(request).toEqual({
      url: '/plugins/usage-statistics/safety/history',
      data: query,
      timeout: 60_000,
    });
  });

  test('sends disabled keys in the POST request body', async () => {
    let request: { url: string; data: unknown; timeout?: number } | undefined;
    apiClient.post = (async (url: string, data, config) => {
      request = { url, data, timeout: config?.timeout };
      return { disabled: ['client-secret'], already_disabled: [], missing: [] };
    }) as typeof apiClient.post;

    await usageSafetyApi.disableKeys(['client-secret']);

    expect(request).toEqual({
      url: '/plugins/usage-statistics/safety/disabled',
      data: { api_keys: ['client-secret'] },
      timeout: 60_000,
    });
  });

  test('sends release keys in the DELETE request body', async () => {
    let request: { url: string; data: unknown; timeout?: number } | undefined;
    apiClient.delete = (async (url: string, config) => {
      request = { url, data: config?.data, timeout: config?.timeout };
      return { released: ['client-secret'], not_blocked: [] };
    }) as typeof apiClient.delete;

    await usageSafetyApi.releaseLimits(['client-secret']);

    expect(request).toEqual({
      url: '/plugins/usage-statistics/safety/limits',
      data: { api_keys: ['client-secret'] },
      timeout: 60_000,
    });
  });

  test('sends enabled keys in the DELETE request body', async () => {
    let request: { url: string; data: unknown; timeout?: number } | undefined;
    apiClient.delete = (async (url: string, config) => {
      request = { url, data: config?.data, timeout: config?.timeout };
      return { enabled: ['client-secret'], already_enabled: [], missing: [] };
    }) as typeof apiClient.delete;

    await usageSafetyApi.enableKeys(['client-secret']);

    expect(request).toEqual({
      url: '/plugins/usage-statistics/safety/disabled',
      data: { api_keys: ['client-secret'] },
      timeout: 60_000,
    });
  });
});
