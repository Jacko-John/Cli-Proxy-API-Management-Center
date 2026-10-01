import { afterEach, describe, expect, test } from 'bun:test';
import axios, { type AxiosAdapter, type AxiosRequestTransformer } from 'axios';
import { apiClient } from '../../src/services/api/client';
import { usagePluginClient } from '../../src/services/api/usagePluginClient';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const pluginPath = '/v0/management/plugins/usage-statistics/notifications/subscriptions';

afterEach(() => {
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('usage plugin transport', () => {
  test.each(['get', 'post', 'put', 'patch', 'delete'] as const)(
    '%s retains the backend route, authentication, request options and JSON serialization',
    async (method) => {
      apiClient.setConfig({
        apiBase: 'https://proxy.invalid/gateway/v8/management',
        managementKey: 'fixture-only',
      });
      const body = { id: 'subscription-1' };
      const signal = new AbortController().signal;
      const adapter: AxiosAdapter = async (config) => {
        expect(axios.getUri(config)).toBe(`https://proxy.invalid/gateway${pluginPath}?page=2`);
        expect(config.headers.Authorization).toBe('Bearer fixture-only');
        expect(config.headers['X-Fixture']).toBe('plugin');
        expect(config.timeout).toBe(0);
        expect(config.signal).toBe(signal);
        expect(config.data).toBe(method === 'get' ? undefined : JSON.stringify(body));
        return { data: { id: body.id }, status: 200, statusText: 'OK', headers: {}, config };
      };
      const config = {
        adapter,
        signal,
        timeout: 0,
        params: { page: 2 },
        headers: { 'X-Fixture': 'plugin' },
      };
      const result =
        method === 'get'
          ? await usagePluginClient.get(pluginPath, config)
          : method === 'delete'
            ? await usagePluginClient.delete(pluginPath, { ...config, data: body })
            : await usagePluginClient[method](pluginPath, body, config);
      expect(result).toEqual({ id: body.id });
    }
  );

  test.each([
    ['https://proxy.invalid', 'https://proxy.invalid'],
    ['proxy.invalid/gateway/', 'http://proxy.invalid/gateway'],
    ['https://proxy.invalid/gateway/v8/management', 'https://proxy.invalid/gateway'],
    ['https://proxy.invalid/gateway/v8/management/', 'https://proxy.invalid/gateway'],
  ])('preserves the deployment prefix for %s', async (apiBase, expectedBase) => {
    apiClient.setConfig({ apiBase, managementKey: 'fixture-only' });
    const adapter: AxiosAdapter = async (config) => {
      expect(axios.getUri(config)).toBe(`${expectedBase}${pluginPath}`);
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    await usagePluginClient.get(pluginPath, { adapter });
  });

  test('plugin requests do not change the base of subsequent v8 requests', async () => {
    apiClient.setConfig({
      apiBase: 'https://proxy.invalid/gateway',
      managementKey: 'fixture-only',
    });
    const urls: string[] = [];
    const adapter: AxiosAdapter = async (config) => {
      urls.push(axios.getUri(config));
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    await usagePluginClient.get(pluginPath, { adapter });
    await apiClient.get('/config', { adapter });
    expect(urls).toEqual([
      `https://proxy.invalid/gateway${pluginPath}`,
      'https://proxy.invalid/gateway/v8/management/config',
    ]);
  });

  test('uses the current connection after switching servers', async () => {
    const requests: Array<{ url: string; authorization: unknown }> = [];
    const adapter: AxiosAdapter = async (config) => {
      requests.push({ url: axios.getUri(config), authorization: config.headers.Authorization });
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    for (const name of ['first', 'second']) {
      apiClient.setConfig({ apiBase: `https://${name}.invalid`, managementKey: `${name}-fixture` });
      await usagePluginClient.get(pluginPath, { adapter });
    }
    expect(requests).toEqual([
      { url: `https://first.invalid${pluginPath}`, authorization: 'Bearer first-fixture' },
      { url: `https://second.invalid${pluginPath}`, authorization: 'Bearer second-fixture' },
    ]);
  });

  test.each([false, true])('preserves a custom request transform (array: %s)', async (asArray) => {
    apiClient.setConfig({ apiBase: 'https://proxy.invalid', managementKey: 'fixture-only' });
    const transform: AxiosRequestTransformer = (data) => JSON.stringify({ custom: data });
    const adapter: AxiosAdapter = async (config) => {
      expect(axios.getUri(config)).toBe(`https://proxy.invalid${pluginPath}`);
      expect(config.data).toBe(JSON.stringify({ custom: { id: 'subscription-1' } }));
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    await usagePluginClient.post(
      pluginPath,
      { id: 'subscription-1' },
      {
        adapter,
        transformRequest: asArray ? [transform] : transform,
      }
    );
  });

  test('retains version, plugin support and unauthorized events', async () => {
    const events: Event[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => {
          events.push(event);
          return true;
        },
      },
    });
    apiClient.setConfig({ apiBase: 'https://proxy.invalid', managementKey: 'fixture-only' });
    const adapter: AxiosAdapter = async (config) => ({
      data: {},
      status: 200,
      statusText: 'OK',
      config,
      headers: { 'x-cpa-version': 'v8.0.3', 'x-cpa-support-plugin': 'true' },
    });
    await usagePluginClient.get(pluginPath, { adapter });
    expect(events.map((event) => event.type)).toEqual([
      'server-version-update',
      'server-plugin-support-update',
    ]);
    expect((events[0] as CustomEvent).detail.version).toBe('v8.0.3');
    expect((events[1] as CustomEvent).detail.supportsPlugin).toBe(true);

    const unauthorized: AxiosAdapter = async (config) => {
      throw new axios.AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
        data: { error: 'Unauthorized' },
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config,
      });
    };
    await expect(
      usagePluginClient.get(pluginPath, { adapter: unauthorized })
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(events.at(-1)?.type).toBe('unauthorized');
  });
});
