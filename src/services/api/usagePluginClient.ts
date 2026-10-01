import axios, { type AxiosRequestConfig, type AxiosRequestTransformer } from 'axios';
import { normalizeApiBase } from '@/utils/connection';
import { apiClient } from './client';

export const USAGE_PLUGIN_API_BASE = '/v0/management/plugins/usage-statistics';

// Run after the shared client's interceptor sets its v8 base, before Axios sends the request.
// Keep authentication, error handling and response events in the shared client.
const usePluginBase: AxiosRequestTransformer = function (data) {
  this.baseURL = normalizeApiBase(this.baseURL ?? '');
  return data;
};

const pluginConfig = (config: AxiosRequestConfig = {}): AxiosRequestConfig => {
  const transforms = config.transformRequest ?? axios.defaults.transformRequest ?? [];
  return {
    ...config,
    transformRequest: [usePluginBase, ...(Array.isArray(transforms) ? transforms : [transforms])],
  };
};

export const usagePluginClient = {
  get: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    apiClient.get<T>(url, pluginConfig(config)),
  post: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> =>
    apiClient.post<T>(url, data, pluginConfig(config)),
  put: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> =>
    apiClient.put<T>(url, data, pluginConfig(config)),
  patch: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> =>
    apiClient.patch<T>(url, data, pluginConfig(config)),
  delete: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    apiClient.delete<T>(url, pluginConfig(config)),
};
