/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import {
  computeKeyStats,
  normalizeUsageData,
  type KeyStats,
  type UsageDeleteResponse,
  type UsageQueryRange,
} from '@/utils/usage';
import type {
  SafetyDisableResult,
  SafetyEnableResult,
  SafetyHistoryQuery,
  SafetyHistoryResponse,
  SafetyKeysResponse,
  SafetyReleaseResult,
} from '@/types/usageSafety';

const USAGE_TIMEOUT_MS = 60 * 1000;

// usage-statistics 插件端点（官方 CPA 已移除内建 usage API，改由插件提供）。
const USAGE_ENDPOINT = '/plugins/usage-statistics/usage';
const SAFETY_ENDPOINT = '/plugins/usage-statistics/safety';

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: (params?: UsageQueryRange) =>
    apiClient.get<Record<string, unknown>>(USAGE_ENDPOINT, { timeout: USAGE_TIMEOUT_MS, params }),

  /**
   * 删除指定 usage 记录
   */
  deleteUsage: (ids: string[]) =>
    apiClient.delete<UsageDeleteResponse>(USAGE_ENDPOINT, {
      timeout: USAGE_TIMEOUT_MS,
      data: { ids },
    }),

  /**
   * 计算密钥成功/失败统计，必要时会先获取 usage 数据
   */
  async getKeyStats(usageData?: unknown): Promise<KeyStats> {
    let payload = usageData;
    if (!payload) {
      payload = await usageApi.getUsage();
    }
    return computeKeyStats(normalizeUsageData(payload));
  },
};

export const usageSafetyApi = {
  getKeys: () =>
    apiClient.get<SafetyKeysResponse>(`${SAFETY_ENDPOINT}/keys`, {
      timeout: USAGE_TIMEOUT_MS,
    }),

  getHistory: (query: SafetyHistoryQuery) =>
    apiClient.post<SafetyHistoryResponse>(`${SAFETY_ENDPOINT}/history`, query, {
      timeout: USAGE_TIMEOUT_MS,
    }),

  releaseLimits: (apiKeys: string[]) =>
    apiClient.delete<SafetyReleaseResult>(`${SAFETY_ENDPOINT}/limits`, {
      timeout: USAGE_TIMEOUT_MS,
      data: { api_keys: apiKeys },
    }),

  disableKeys: (apiKeys: string[]) =>
    apiClient.post<SafetyDisableResult>(
      `${SAFETY_ENDPOINT}/disabled`,
      { api_keys: apiKeys },
      { timeout: USAGE_TIMEOUT_MS }
    ),

  enableKeys: (apiKeys: string[]) =>
    apiClient.delete<SafetyEnableResult>(`${SAFETY_ENDPOINT}/disabled`, {
      timeout: USAGE_TIMEOUT_MS,
      data: { api_keys: apiKeys },
    }),
};
