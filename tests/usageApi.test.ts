import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { usageApi, type CredentialWindowQuery, type UsagePricing } from '../src/services/api/usage';

const originalGet = apiClient.get;
const originalPost = apiClient.post;
const originalPut = apiClient.put;

const pricing: UsagePricing = {
  prices: {
    'model-a': {
      input: 1,
      output: 2,
      cacheCreate: 3,
      cacheRead: 4,
    },
  },
  tier_multipliers: [{ model: 'model-a', tier: 'priority', multiplier: 2 }],
};

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.post = originalPost;
  apiClient.put = originalPut;
});

describe('usage API', () => {
  test('reads a precomputed summary without sending pricing', async () => {
    let request: { url: string; data: unknown; timeout?: number } | undefined;
    apiClient.post = (async (url: string, data, config) => {
      request = { url, data, timeout: config?.timeout };
      return { total_requests: 0, success_count: 0, failure_count: 0, total_tokens: 0, apis: {} };
    }) as typeof apiClient.post;

    await usageApi.getSummary('24h');

    expect(request).toEqual({
      url: '/plugins/usage-statistics/usage',
      data: { range: '24h' },
      timeout: 60_000,
    });
  });

  test('loads at most 100 recent events', async () => {
    let request: { url: string; params: unknown; timeout?: number } | undefined;
    apiClient.get = (async (url: string, config) => {
      request = { url, params: config?.params, timeout: config?.timeout };
      return {};
    }) as typeof apiClient.get;

    await usageApi.getUsage({ start: '2026-09-01T00:00:00Z' });

    expect(request).toEqual({
      url: '/plugins/usage-statistics/usage',
      params: {
        start: '2026-09-01T00:00:00Z',
        limit: 100,
      },
      timeout: 60_000,
    });
  });

  test('reads credential windows without sending pricing', async () => {
    let request: { url: string; data: unknown; timeout?: number } | undefined;
    apiClient.post = (async (url: string, data, config) => {
      request = { url, data, timeout: config?.timeout };
      return { windows: {} };
    }) as typeof apiClient.post;
    const windows: CredentialWindowQuery[] = [
      {
        id: 'credential.json',
        auth_index: 'auth-1',
        source: 'credential.json',
        category: 'claude_gpt',
        start: 100,
        end: 200,
      },
    ];

    await usageApi.getCredentialWindows(windows);

    expect(request).toEqual({
      url: '/plugins/usage-statistics/usage/credential-windows',
      data: { windows },
      timeout: 60_000,
    });
  });

  test('reads and updates backend pricing', async () => {
    const requests: Array<{ method: string; url: string; data?: unknown; timeout?: number }> = [];
    apiClient.get = (async (url: string, config) => {
      requests.push({ method: 'GET', url, timeout: config?.timeout });
      return pricing;
    }) as typeof apiClient.get;
    apiClient.put = (async (url: string, data, config) => {
      requests.push({ method: 'PUT', url, data, timeout: config?.timeout });
      return pricing;
    }) as typeof apiClient.put;

    expect(await usageApi.getPricing()).toEqual(pricing);
    expect(await usageApi.updatePricing(pricing)).toEqual(pricing);
    expect(requests).toEqual([
      {
        method: 'GET',
        url: '/plugins/usage-statistics/pricing',
        timeout: 60_000,
      },
      {
        method: 'PUT',
        url: '/plugins/usage-statistics/pricing',
        data: pricing,
        timeout: 0,
      },
    ]);
  });
});
