/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import {
  computeKeyStats,
  normalizeUsageData,
  type KeyStats,
  type ModelPrice,
  type UsageDeleteResponse,
  type UsageQueryRange,
  type UsageStatsSnapshot,
  type UsageTimeRange,
} from '@/utils/usage';
import type { TierMultiplierRule } from '@/utils/tierMultiplier';
import type {
  SafetyDisableResult,
  SafetyEnableResult,
  SafetyHistoryQuery,
  SafetyHistoryResponse,
  SafetyKeysResponse,
  SafetyReleaseResult,
} from '@/types/usageSafety';

const USAGE_TIMEOUT_MS = 60 * 1000;
const PRICING_UPDATE_TIMEOUT_MS = 0;

// usage-statistics 插件端点（官方 CPA 已移除内建 usage API，改由插件提供）。
const USAGE_ENDPOINT = '/plugins/usage-statistics/usage';
const PRICING_ENDPOINT = '/plugins/usage-statistics/pricing';
const SAFETY_ENDPOINT = '/plugins/usage-statistics/safety';

export interface CredentialWindowQuery {
  id: string;
  auth_index?: string;
  source?: string;
  category?: 'all' | 'claude_gpt' | 'gemini';
  start: number;
  end: number;
}

export interface CredentialWindowSummary {
  requests: number;
  success_count: number;
  failure_count: number;
  tokens: number;
  cost: number;
}

export interface CredentialWindowsResponse {
  windows: Record<string, CredentialWindowSummary>;
}

export interface UsagePricing {
  prices: Record<string, ModelPrice>;
  tier_multipliers: TierMultiplierRule[];
}

export const usageApi = {
  /**
   * 读取插件预先计算的统计快照。
   */
  getSummary: (range: UsageTimeRange) =>
    apiClient.post<UsageStatsSnapshot>(USAGE_ENDPOINT, { range }, { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 按需获取最新请求事件；插件端始终限制为最多 100 条。
   */
  getUsage: (params?: UsageQueryRange) =>
    apiClient.get<Record<string, unknown>>(USAGE_ENDPOINT, {
      timeout: USAGE_TIMEOUT_MS,
      params: { ...params, limit: 100 },
    }),

  getCredentialWindows: (windows: CredentialWindowQuery[]) =>
    apiClient.post<CredentialWindowsResponse>(
      `${USAGE_ENDPOINT}/credential-windows`,
      { windows },
      { timeout: USAGE_TIMEOUT_MS }
    ),

  getPricing: () =>
    apiClient.get<UsagePricing>(PRICING_ENDPOINT, {
      timeout: USAGE_TIMEOUT_MS,
    }),

  updatePricing: (pricing: UsagePricing) =>
    apiClient.put<UsagePricing>(PRICING_ENDPOINT, pricing, {
      timeout: PRICING_UPDATE_TIMEOUT_MS,
    }),

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
      payload = await usageApi.getSummary('all');
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
