import { describe, expect, test } from 'bun:test';
import { buildCredentialUsageRows } from '../src/utils/credentialUsage';
import {
  buildDailyCostSeries,
  buildDailySeriesByModel,
  buildHourlyCostSeries,
  buildHourlySeriesByModel,
  calculateRecentPerMinuteRates,
  calculateTotalCost,
  collectUsageDetails,
  getModelStats,
  normalizeUsageData,
} from '../src/utils/usage';

const currentHourUnix = Math.floor(Date.now() / (60 * 60 * 1000)) * 60 * 60;
const currentDayUnix = Math.floor(Date.now() / (24 * 60 * 60 * 1000)) * 24 * 60 * 60;

const usage = {
  total_requests: 3,
  success_count: 2,
  failure_count: 1,
  total_tokens: 600,
  total_cost: 1.5,
  rate_requests: 2,
  rate_tokens: 500,
  rate_minutes: 30,
  apis: {
    'client-key': {
      total_requests: 3,
      success_count: 2,
      failure_count: 1,
      total_tokens: 600,
      total_cost: 1.5,
      latency_total_ms: 900,
      latency_sample_count: 3,
      first_byte_latency_total_ms: 120,
      first_byte_latency_sample_count: 3,
      positive_first_byte_latency_sample_count: 2,
      tps_total: 30,
      tps_sample_count: 2,
      models: {
        'model-a': {
          total_requests: 3,
          success_count: 2,
          failure_count: 1,
          total_tokens: 600,
          total_cost: 1.5,
          latency_total_ms: 900,
          latency_sample_count: 3,
          first_byte_latency_total_ms: 120,
          first_byte_latency_sample_count: 3,
          positive_first_byte_latency_sample_count: 2,
          tps_total: 30,
          tps_sample_count: 2,
        },
      },
    },
  },
  credentials: {
    'source:credential.json': {
      source: 'credential.json',
      auth_type: 'codex',
      total_requests: 3,
      success_count: 2,
      failure_count: 1,
      total_tokens: 600,
      total_cost: 1.5,
    },
  },
  hours: {
    [currentHourUnix]: {
      total_requests: 3,
      success_count: 2,
      failure_count: 1,
      total_tokens: 600,
      total_cost: 1.5,
    },
  },
  days: {
    [currentDayUnix]: {
      total_requests: 3,
      success_count: 2,
      failure_count: 1,
      total_tokens: 600,
      total_cost: 1.5,
    },
  },
};

describe('precomputed usage snapshots', () => {
  test('reads totals, rates, latency and TPS without request details', () => {
    expect(calculateTotalCost(usage, {})).toBe(1.5);
    expect(calculateRecentPerMinuteRates(30, usage)).toEqual({
      rpm: 2 / 30,
      tpm: 500 / 30,
      windowMinutes: 30,
      requestCount: 2,
      tokenCount: 500,
    });

    expect(getModelStats(usage)).toEqual([
      {
        model: 'model-a',
        requests: 3,
        successCount: 2,
        failureCount: 1,
        tokens: 600,
        cost: 1.5,
        averageLatencyMs: 300,
        averageFirstByteLatencyMs: 60,
        averageTps: 15,
        latencySampleCount: 3,
        firstByteLatencySampleCount: 2,
        tpsSampleCount: 2,
      },
    ]);
  });

  test('maps the source aggregate to its credential file', () => {
    const rows = buildCredentialUsageRows({
      usage,
      authFiles: [
        {
          name: 'credential.json',
          type: 'codex',
          auth_index: 'auth-1',
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'file:credential.json',
      displayName: 'credential.json',
      requests: 3,
      successCount: 2,
      failureCount: 1,
      tokens: 600,
      cost: 1.5,
      successRate: (2 / 3) * 100,
    });
  });

  test('normalizes on-demand backend events for request detail rendering', () => {
    const normalized = normalizeUsageData({
      'client-key': {
        'model-a': [
          {
            id: 'event-1',
            timestamp: '2026-09-01T20:06:25Z',
            source: 'credential.json',
            failed: true,
            tokens: { total_tokens: 10 },
          },
        ],
      },
    });

    const details = collectUsageDetails(normalized);
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      id: 'event-1',
      timestamp: '2026-09-01T20:06:25Z',
      failed: true,
      __modelName: 'model-a',
    });
  });

  test('uses backend server dates for daily series', () => {
    const serverDayUsage = {
      days: {
        '2026-09-02': {
          total_requests: 2,
          total_tokens: 300,
          total_cost: 0.75,
        },
      },
    };

    const requests = buildDailySeriesByModel(serverDayUsage, 'requests');
    const cost = buildDailyCostSeries(serverDayUsage);

    expect(requests.labels).toEqual(['2026-09-02']);
    expect(requests.dataByModel.get('all')).toEqual([2]);
    expect(cost).toEqual({ labels: ['2026-09-02'], data: [0.75], hasData: true });
  });

  test('builds request, token and cost series from aggregate buckets', () => {
    const hourlyRequests = buildHourlySeriesByModel(usage, 'requests', 24 * 31);
    const hourlyTokens = buildHourlySeriesByModel(usage, 'tokens', 24 * 31);
    const dailyRequests = buildDailySeriesByModel(usage, 'requests');
    const hourlyCost = buildHourlyCostSeries(usage, 24 * 31);
    const dailyCost = buildDailyCostSeries(usage);

    expect(hourlyRequests.hasData).toBe(true);
    expect(hourlyRequests.dataByModel.get('all')?.reduce((sum, value) => sum + value, 0)).toBe(3);
    expect(hourlyTokens.dataByModel.get('all')?.reduce((sum, value) => sum + value, 0)).toBe(600);
    expect(dailyRequests.dataByModel.get('all')?.reduce((sum, value) => sum + value, 0)).toBe(3);
    expect(hourlyCost.data.reduce((sum, value) => sum + value, 0)).toBe(1.5);
    expect(dailyCost.data.reduce((sum, value) => sum + value, 0)).toBe(1.5);
  });
});
