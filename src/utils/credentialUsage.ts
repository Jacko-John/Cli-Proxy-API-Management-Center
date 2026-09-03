import type { AuthFileItem } from '@/types/authFile';
import {
  calculateCost,
  collectUsageDetails,
  extractTotalTokens,
  normalizeAuthIndex,
  type ModelPrice,
  type UsageDetail,
} from '@/utils/usage';

export interface CredentialUsageRow {
  key: string;
  displayName: string;
  type: string;
  authIndex: string | null;
  authFileName: string | null;
  requests: number;
  successCount: number;
  failureCount: number;
  tokens: number;
  cost: number;
  successRate: number;
}

export const CREDENTIAL_COST_WINDOW_GRACE_MS = 60 * 1000;

export interface CredentialCostEvent {
  completedAtMs: number;
  cost: number;
  tokens: number;
  failed: boolean;
}

export interface CredentialWindowUsageSummary {
  requests: number;
  successCount: number;
  failureCount: number;
  tokens: number;
  cost: number;
}

interface CredentialUsageInput {
  usage: unknown;
  authFiles: AuthFileItem[];
}

interface CredentialCostInput extends CredentialUsageInput {
  modelPrices: Record<string, ModelPrice>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

interface AuthFileLookup {
  sourceToFile: Map<string, AuthFileItem>;
}

interface CredentialMatch {
  rowKey: string;
  displayName: string;
  type: string;
  authIndex: string | null;
  authFileName: string | null;
}

export const normalizeCredentialType = (file?: AuthFileItem) => {
  const rawType =
    typeof file?.type === 'string'
      ? file.type
      : typeof file?.provider === 'string'
        ? file.provider
        : '';
  return rawType.trim().toLowerCase() || 'unknown';
};

const normalizeCredentialSource = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const source = value.trim();
  return source.startsWith('t:') ? source.slice(2).trim() : source;
};

const credentialSourceBaseName = (source: string): string => {
  const normalized = source.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
};

export const getCredentialSourceForFile = (file: AuthFileItem): string =>
  normalizeCredentialSource(file.path) || normalizeCredentialSource(file.name);

export const getCredentialRowKeyForFile = (file: AuthFileItem): string => `file:${file.name}`;

const buildAuthFileLookup = (authFiles: AuthFileItem[]): AuthFileLookup => {
  const sourceToFile = new Map<string, AuthFileItem>();

  authFiles.forEach((file) => {
    const source = getCredentialSourceForFile(file);
    if (source) sourceToFile.set(source, file);
    if (file.name) sourceToFile.set(file.name, file);
  });

  return { sourceToFile };
};

const resolveCredentialMatch = (
  detail: UsageDetail,
  lookup: AuthFileLookup
): CredentialMatch | null => {
  const source = normalizeCredentialSource(detail.source);
  if (!source) return null;

  const matchedFile =
    lookup.sourceToFile.get(source) ?? lookup.sourceToFile.get(credentialSourceBaseName(source));
  if (!matchedFile) return null;

  const authIndex = normalizeAuthIndex(matchedFile['auth_index'] ?? matchedFile.authIndex);
  return {
    rowKey: `file:${matchedFile.name}`,
    displayName: matchedFile.name,
    type: normalizeCredentialType(matchedFile),
    authIndex: authIndex ?? null,
    authFileName: matchedFile.name,
  };
};

const getRequestCompletedAtMs = (detail: UsageDetail): number => {
  const timestampMs = detail.__timestampMs ?? Date.parse(detail.timestamp);
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return Number.NaN;

  const latencyMs =
    typeof detail.latency_ms === 'number' &&
    Number.isFinite(detail.latency_ms) &&
    detail.latency_ms > 0
      ? detail.latency_ms
      : 0;
  return timestampMs + latencyMs;
};

export function buildCredentialUsageRows({
  usage,
  authFiles,
}: CredentialUsageInput): CredentialUsageRow[] {
  if (!usage) return [];

  const lookup = buildAuthFileLookup(authFiles);
  const usageRecord = isRecord(usage) ? usage : null;
  const precomputed = isRecord(usageRecord?.credentials) ? usageRecord.credentials : null;
  if (precomputed) {
    const rows = new Map<string, CredentialUsageRow>();
    Object.entries(precomputed).forEach(([key, raw]) => {
      if (!isRecord(raw)) return;
      const match = resolveCredentialMatch(
        {
          timestamp: '',
          source:
            typeof raw.source === 'string'
              ? raw.source
              : key.startsWith('source:')
                ? key.slice('source:'.length)
                : '',
          auth_index:
            typeof raw.auth_index === 'string' || typeof raw.auth_index === 'number'
              ? raw.auth_index
              : null,
          tokens: {
            input_tokens: 0,
            output_tokens: 0,
            reasoning_tokens: 0,
            cached_tokens: 0,
            total_tokens: 0,
          },
          failed: false,
        },
        lookup
      );
      if (!match) return;
      const rowKey = match.rowKey || key;
      const requests = Number(raw.total_requests) || 0;
      const successCount = Number(raw.success_count) || 0;
      const failureCount = Number(raw.failure_count) || 0;
      const existing = rows.get(rowKey) ?? {
        key: rowKey,
        displayName: match.displayName,
        type: match.type,
        authIndex: match.authIndex,
        authFileName: match.authFileName,
        requests: 0,
        successCount: 0,
        failureCount: 0,
        tokens: 0,
        cost: 0,
        successRate: 100,
      };
      existing.requests += requests;
      existing.successCount += successCount;
      existing.failureCount += failureCount;
      existing.tokens += Number(raw.total_tokens) || 0;
      existing.cost += Number(raw.total_cost) || 0;
      existing.successRate =
        existing.requests > 0 ? (existing.successCount / existing.requests) * 100 : 100;
      rows.set(rowKey, existing);
    });
    return Array.from(rows.values());
  }

  const rowMap = new Map<string, CredentialUsageRow>();

  collectUsageDetails(usage).forEach((detail) => {
    const match = resolveCredentialMatch(detail, lookup);
    if (!match) return;

    const existing = rowMap.get(match.rowKey) ?? {
      key: match.rowKey,
      displayName: match.displayName,
      type: match.type,
      authIndex: match.authIndex,
      authFileName: match.authFileName,
      requests: 0,
      successCount: 0,
      failureCount: 0,
      tokens: 0,
      cost: 0,
      successRate: 100,
    };

    existing.requests += 1;
    if (detail.failed === true) {
      existing.failureCount += 1;
    } else {
      existing.successCount += 1;
    }
    existing.tokens += extractTotalTokens(detail);
    existing.successRate =
      existing.requests > 0 ? (existing.successCount / existing.requests) * 100 : 100;
    rowMap.set(match.rowKey, existing);
  });

  return Array.from(rowMap.values());
}

export function buildCredentialCostBuckets({
  usage,
  authFiles,
  modelPrices,
}: CredentialCostInput): Map<string, CredentialCostEvent[]> {
  const buckets = new Map<string, CredentialCostEvent[]>();

  authFiles.forEach((file) => {
    if (file.name) {
      buckets.set(getCredentialRowKeyForFile(file), []);
    }
  });

  if (!usage) return buckets;

  const lookup = buildAuthFileLookup(authFiles);

  collectUsageDetails(usage).forEach((detail) => {
    const match = resolveCredentialMatch(detail, lookup);
    if (!match) return;

    const completedAtMs = getRequestCompletedAtMs(detail);
    if (!Number.isFinite(completedAtMs) || completedAtMs <= 0) return;

    const events = buckets.get(match.rowKey) ?? [];
    events.push({
      completedAtMs,
      cost: calculateCost(detail, modelPrices),
      tokens: extractTotalTokens(detail),
      failed: detail.failed === true,
    });
    buckets.set(match.rowKey, events);
  });

  return buckets;
}

export function sumCredentialUsageInWindow(
  events: CredentialCostEvent[],
  startMs: number,
  endMs: number,
  graceMs: number = 0
): CredentialWindowUsageSummary {
  const normalizedGraceMs = Number.isFinite(graceMs) && graceMs > 0 ? graceMs : 0;
  const effectiveStartMs = startMs - normalizedGraceMs;
  const effectiveEndMs = endMs + normalizedGraceMs;

  return events.reduce<CredentialWindowUsageSummary>(
    (summary, item) => {
      if (item.completedAtMs < effectiveStartMs || item.completedAtMs > effectiveEndMs) {
        return summary;
      }

      summary.requests += 1;
      if (item.failed) {
        summary.failureCount += 1;
      } else {
        summary.successCount += 1;
      }
      summary.tokens += item.tokens;
      summary.cost += item.cost;
      return summary;
    },
    {
      requests: 0,
      successCount: 0,
      failureCount: 0,
      tokens: 0,
      cost: 0,
    }
  );
}

export function sumCostInWindow(
  events: CredentialCostEvent[],
  startMs: number,
  endMs: number,
  graceMs: number = 0
): number {
  return sumCredentialUsageInWindow(events, startMs, endMs, graceMs).cost;
}
