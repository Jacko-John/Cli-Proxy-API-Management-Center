import { create } from 'zustand';
import { usageApi } from '@/services/api/usage';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  normalizeUsageData,
  type UsageDeleteResponse,
  type UsageStatsSnapshot,
  type UsageTimeRange,
} from '@/utils/usage';
import i18n from '@/i18n';

export const USAGE_STATS_STALE_TIME_MS = 240_000;

const USAGE_RANGE_MS: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  '7h': 7 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export type LoadUsageStatsOptions = {
  force?: boolean;
  staleTimeMs?: number;
  timeRange?: UsageTimeRange;
};

type UsageStatsState = {
  usage: UsageStatsSnapshot | null;
  eventsUsage: UsageStatsSnapshot | Record<string, unknown> | null;
  eventsLoaded: boolean;
  loading: boolean;
  eventsLoading: boolean;
  error: string | null;
  eventsError: string | null;
  lastRefreshedAt: number | null;
  eventsRefreshedAt: number | null;
  scopeKey: string;
  requestKey: string;
  loadUsageStats: (options?: LoadUsageStatsOptions) => Promise<void>;
  loadUsageEvents: (timeRange?: UsageTimeRange, force?: boolean) => Promise<void>;
  deleteUsageRecords: (ids: string[]) => Promise<UsageDeleteResponse>;
  clearUsageStats: () => void;
};

let summaryRequest: { key: string; promise: Promise<void> } | null = null;
let eventsRequest: { key: string; promise: Promise<void> } | null = null;

const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : i18n.t('usage_stats.loading_error');

const getScopeKey = () => {
  const { apiBase = '', managementKey = '' } = useAuthStore.getState();
  return `${apiBase}::${managementKey}`;
};

const eventsRangeParams = (timeRange: UsageTimeRange, now = Date.now()) => {
  if (timeRange === 'all') return undefined;
  return { start: new Date(now - USAGE_RANGE_MS[timeRange]).toISOString() };
};

const clearForScope = (scopeKey: string) => ({
  usage: null,
  eventsUsage: null,
  eventsLoaded: false,
  loading: false,
  eventsLoading: false,
  error: null,
  eventsError: null,
  lastRefreshedAt: null,
  eventsRefreshedAt: null,
  requestKey: '',
  scopeKey,
});

export const useUsageStatsStore = create<UsageStatsState>((set, get) => ({
  usage: null,
  eventsUsage: null,
  eventsLoaded: false,
  loading: false,
  eventsLoading: false,
  error: null,
  eventsError: null,
  lastRefreshedAt: null,
  eventsRefreshedAt: null,
  scopeKey: '',
  requestKey: '',

  loadUsageStats: async (options = {}) => {
    const scopeKey = getScopeKey();
    const range = options.timeRange ?? '24h';
    const requestKey = `${scopeKey}::${range}`;
    const now = Date.now();
    const state = get();

    if (state.scopeKey !== scopeKey) {
      summaryRequest = null;
      eventsRequest = null;
      set(clearForScope(scopeKey));
    }

    const current = get();
    const staleTimeMs = options.staleTimeMs ?? USAGE_STATS_STALE_TIME_MS;
    if (
      !options.force &&
      current.requestKey === requestKey &&
      current.lastRefreshedAt !== null &&
      now - current.lastRefreshedAt < staleTimeMs
    ) {
      return;
    }
    if (summaryRequest?.key === requestKey) {
      await summaryRequest.promise;
      return;
    }

    set({ loading: true, error: null, scopeKey });
    const promise = (async () => {
      try {
        const response = await usageApi.getSummary(range);
        if (getScopeKey() !== scopeKey || summaryRequest?.key !== requestKey) return;
        const usage = normalizeUsageData(response) as UsageStatsSnapshot | null;
        set({
          usage,
          loading: false,
          error: null,
          lastRefreshedAt: Date.now(),
          requestKey,
          scopeKey,
        });
      } catch (error: unknown) {
        if (getScopeKey() !== scopeKey || summaryRequest?.key !== requestKey) return;
        set({ loading: false, error: getErrorMessage(error), scopeKey });
        throw error;
      } finally {
        if (summaryRequest?.key === requestKey) summaryRequest = null;
      }
    })();
    summaryRequest = { key: requestKey, promise };
    await promise;
  },

  loadUsageEvents: async (timeRange = '24h', force = false) => {
    const scopeKey = getScopeKey();
    const requestKey = `${scopeKey}::${timeRange}`;
    const state = get();
    if (state.scopeKey !== scopeKey) {
      summaryRequest = null;
      eventsRequest = null;
      set(clearForScope(scopeKey));
    }
    const current = get();
    if (!force && current.eventsLoaded && current.eventsRefreshedAt !== null) return;
    if (eventsRequest?.key === requestKey) {
      await eventsRequest.promise;
      return;
    }

    set({ eventsLoading: true, eventsError: null, scopeKey });
    const promise = (async () => {
      try {
        const response = await usageApi.getUsage(eventsRangeParams(timeRange));
        if (getScopeKey() !== scopeKey || eventsRequest?.key !== requestKey) return;
        set({
          eventsUsage: normalizeUsageData(response),
          eventsLoaded: true,
          eventsLoading: false,
          eventsError: null,
          eventsRefreshedAt: Date.now(),
          scopeKey,
        });
      } catch (error: unknown) {
        if (getScopeKey() !== scopeKey || eventsRequest?.key !== requestKey) return;
        set({ eventsLoading: false, eventsError: getErrorMessage(error), scopeKey });
        throw error;
      } finally {
        if (eventsRequest?.key === requestKey) eventsRequest = null;
      }
    })();
    eventsRequest = { key: requestKey, promise };
    await promise;
  },

  deleteUsageRecords: async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (!uniqueIds.length) return { deleted: 0, missing: [] };
    return usageApi.deleteUsage(uniqueIds);
  },

  clearUsageStats: () => {
    summaryRequest = null;
    eventsRequest = null;
    set({
      usage: null,
      eventsUsage: null,
      eventsLoaded: false,
      loading: false,
      eventsLoading: false,
      error: null,
      eventsError: null,
      lastRefreshedAt: null,
      eventsRefreshedAt: null,
      scopeKey: '',
      requestKey: '',
    });
  },
}));
