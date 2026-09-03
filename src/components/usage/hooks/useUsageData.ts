import { useCallback, useEffect, useState } from 'react';
import { usageApi, type UsagePricing } from '@/services/api/usage';
import { USAGE_STATS_STALE_TIME_MS, useUsageStatsStore } from '@/stores/useUsageStatsStore';
import type { TierMultiplierRule } from '@/utils/tierMultiplier';
import type { ModelPrice, UsageTimeRange } from '@/utils/usage';

export interface UsagePayload {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  total_cost?: number;
  apis?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UseUsageDataOptions {
  timeRange?: UsageTimeRange;
  includePricing?: boolean;
}

export interface UseUsageDataReturn {
  usage: UsagePayload | null;
  loading: boolean;
  error: string;
  lastRefreshedAt: Date | null;
  modelPrices: Record<string, ModelPrice>;
  tierMultipliers: TierMultiplierRule[];
  pricingSaving: boolean;
  updatePricing: (
    prices: Record<string, ModelPrice>,
    tierMultipliers: TierMultiplierRule[]
  ) => Promise<void>;
  loadUsage: () => Promise<void>;
}

const emptyPricing: UsagePricing = {
  prices: {},
  tier_multipliers: [],
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

export function useUsageData(options: UseUsageDataOptions = {}): UseUsageDataReturn {
  const { timeRange, includePricing = false } = options;
  const usageSnapshot = useUsageStatsStore((state) => state.usage);
  const loading = useUsageStatsStore((state) => state.loading);
  const storeError = useUsageStatsStore((state) => state.error);
  const lastRefreshedAtTs = useUsageStatsStore((state) => state.lastRefreshedAt);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);
  const [pricing, setPricing] = useState<UsagePricing>(emptyPricing);
  const [pricingSaving, setPricingSaving] = useState(false);
  const [pricingError, setPricingError] = useState('');

  const loadPricing = useCallback(async () => {
    try {
      setPricing(await usageApi.getPricing());
      setPricingError('');
    } catch (error) {
      setPricingError(errorMessage(error));
      throw error;
    }
  }, []);

  const loadUsage = useCallback(async () => {
    await Promise.all([
      loadUsageStats({
        force: true,
        staleTimeMs: USAGE_STATS_STALE_TIME_MS,
        timeRange,
      }),
      ...(includePricing ? [loadPricing()] : []),
    ]);
  }, [includePricing, loadPricing, loadUsageStats, timeRange]);

  useEffect(() => {
    if (includePricing) {
      void loadPricing().catch(() => {});
    }
  }, [includePricing, loadPricing]);

  useEffect(() => {
    void loadUsageStats({
      staleTimeMs: USAGE_STATS_STALE_TIME_MS,
      timeRange,
    }).catch(() => {});
  }, [loadUsageStats, timeRange]);

  const updatePricing = useCallback(
    async (prices: Record<string, ModelPrice>, tierMultipliers: TierMultiplierRule[]) => {
      setPricingSaving(true);
      setPricingError('');
      try {
        const updated = await usageApi.updatePricing({
          prices,
          tier_multipliers: tierMultipliers,
        });
        setPricing(updated);
        await loadUsageStats({ force: true, timeRange });
      } catch (error) {
        setPricingError(errorMessage(error));
        throw error;
      } finally {
        setPricingSaving(false);
      }
    },
    [loadUsageStats, timeRange]
  );

  return {
    usage: usageSnapshot as UsagePayload | null,
    loading,
    error: pricingError || storeError || '',
    lastRefreshedAt: lastRefreshedAtTs ? new Date(lastRefreshedAtTs) : null,
    modelPrices: pricing.prices,
    tierMultipliers: pricing.tier_multipliers,
    pricingSaving,
    updatePricing,
    loadUsage,
  };
}
