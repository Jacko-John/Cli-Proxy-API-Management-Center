import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ANTIGRAVITY_CONFIG } from '@/features/quota/providers/antigravity/data';
import {
  getAntigravityCredentialWindowRange,
  getAntigravityWindowDurationMs,
} from '@/fork/antigravityCredentialWindow';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconRefreshCw } from '@/components/ui/icons';
import { useQuotaStore } from '@/stores';
import type { CredentialWindowQuery } from '@/services/api/usage';
import type {
  AuthFileItem,
  AntigravityQuotaState,
  AntigravityQuotaGroup,
  AntigravityQuotaBucket,
} from '@/types';
import { isAntigravityFile } from '@/utils/quota';
import { getCredentialSourceForFile } from '@/utils/credentialUsage';
import { formatCompactNumber, formatUsd } from '@/utils/usage';
import { useCredentialWindowUsage } from './useCredentialWindowUsage';
import styles from '@/pages/CredentialCenterPage.module.scss';

const DEFAULT_REFRESH_INTERVAL_SECONDS = '0.5';

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const getRefreshIntervalMs = (value: string): number => {
  const seconds = Number.parseFloat(value);
  if (!Number.isFinite(seconds) || seconds < 0)
    return Number.parseFloat(DEFAULT_REFRESH_INTERVAL_SECONDS) * 1000;
  return seconds * 1000;
};

interface BatchProgress {
  running: boolean;
  total: number;
  done: number;
  success: number;
  failed: number;
  mode: 'all' | 'missing' | null;
}

const emptyProgress = (): BatchProgress => ({
  running: false,
  total: 0,
  done: 0,
  success: 0,
  failed: 0,
  mode: null,
});

interface AntigravityCredentialQuotaCardProps {
  loading: boolean;
  authFiles: AuthFileItem[];
  quotaType: 'claude' | 'gemini';
}

interface QuotaSelection {
  group: AntigravityQuotaGroup | null;
  start: number | null;
  end: number | null;
}

interface QuotaRow {
  group: AntigravityQuotaGroup | null;
  summary: {
    requests: number;
    successCount: number;
    failureCount: number;
    tokens: number;
    cost: number;
  } | null;
}

const selectQuotaGroup = (
  quotaState: AntigravityQuotaState | undefined,
  quotaType: 'claude' | 'gemini'
): AntigravityQuotaGroup | null => {
  const groups = quotaState?.groups ?? [];
  if (groups.length === 0) return null;
  // Upstream derives the group id from the display label via toStableId, so the
  // Claude group is now e.g. "claude-and-gpt-models" rather than a fixed "claude-gpt".
  // Match by keyword across id + label so the lookup survives label/id changes.
  const matchesKeyword = (group: AntigravityQuotaGroup, keywords: string[]): boolean => {
    const haystack = `${group.id} ${group.label}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  };
  if (quotaType === 'claude') {
    return groups.find((g) => matchesKeyword(g, ['claude', 'gpt'])) ?? null;
  }
  return groups.find((g) => matchesKeyword(g, ['gemini'])) ?? null;
};

// Pick the bucket covering the longest time window (e.g. weekly rather than 5h). When the
// window field is missing/unknown, fall back to the latest reset time as a length proxy.
const selectLongestWindowBucket = (
  group: AntigravityQuotaGroup | null
): AntigravityQuotaBucket | null => {
  if (!group || !group.buckets || group.buckets.length === 0) return null;
  let best: AntigravityQuotaBucket | null = null;
  let bestDuration = -1;
  let bestResetMs = Number.NEGATIVE_INFINITY;
  for (const bucket of group.buckets) {
    const duration = getAntigravityWindowDurationMs(bucket) ?? 0;
    const parsedReset = bucket.resetTime ? Date.parse(bucket.resetTime) : Number.NaN;
    const resetMs = Number.isFinite(parsedReset) ? parsedReset : Number.NEGATIVE_INFINITY;
    if (duration > bestDuration || (duration === bestDuration && resetMs > bestResetMs)) {
      best = bucket;
      bestDuration = duration;
      bestResetMs = resetMs;
    }
  }
  return best;
};

const getRemainingPercentValue = (group: AntigravityQuotaGroup | null): number | null => {
  // Use the longest time window (e.g. weekly rather than 5h) as the source of truth.
  const bucket = selectLongestWindowBucket(group);
  if (!bucket || typeof bucket.remainingFraction !== 'number') return null;
  return Math.max(0, Math.min(100, bucket.remainingFraction * 100));
};

const getRemainingPercentLabel = (group: AntigravityQuotaGroup | null): string => {
  const remainingPercent = getRemainingPercentValue(group);
  return remainingPercent === null ? '--' : `${Math.round(remainingPercent)}%`;
};

const estimateQuotaCost = (
  cost: number | null | undefined,
  group: AntigravityQuotaGroup | null
): number | null => {
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null;
  const remainingPercent = getRemainingPercentValue(group);
  if (remainingPercent === null) return null;
  const usedRatio = 1 - remainingPercent / 100;
  if (usedRatio <= 0) return null;
  return cost / usedRatio;
};

const selectAntigravityCredentialWindow = (
  quotaState: AntigravityQuotaState | undefined,
  quotaType: 'claude' | 'gemini'
): QuotaSelection => {
  const group = selectQuotaGroup(quotaState, quotaType);
  const range = getAntigravityCredentialWindowRange(selectLongestWindowBucket(group));
  return {
    group,
    start: range?.start ?? null,
    end: range?.end ?? null,
  };
};

const formatResetLabel = (resetTime: string | undefined): string => {
  if (!resetTime) return '-';
  try {
    const date = new Date(resetTime);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  } catch {
    return '-';
  }
};

const renderRequestCount = (
  summary: { requests: number; successCount: number; failureCount: number } | null | undefined
) => {
  if (!summary) return '--';

  return (
    <span className={styles.requestCountCell}>
      <span>{summary.requests.toLocaleString()}</span>
      <span className={styles.requestBreakdown}>
        (<span className={styles.statSuccess}>{summary.successCount.toLocaleString()}</span>{' '}
        <span className={styles.statFailure}>{summary.failureCount.toLocaleString()}</span>)
      </span>
    </span>
  );
};

export function AntigravityCredentialQuotaCard({
  loading,
  authFiles,
  quotaType,
}: AntigravityCredentialQuotaCardProps) {
  const { t } = useTranslation();
  const [refreshingKeys, setRefreshingKeys] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(
    DEFAULT_REFRESH_INTERVAL_SECONDS
  );
  const [progress, setProgress] = useState<BatchProgress>(emptyProgress);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const setAntigravityQuota = useQuotaStore((state) => state.setAntigravityQuota);

  const antigravityFiles = useMemo(
    () => authFiles.filter((file) => file.name && isAntigravityFile(file)),
    [authFiles]
  );
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredAntigravityFiles = useMemo(
    () =>
      antigravityFiles.filter(
        (file) => !normalizedSearchTerm || file.name.toLowerCase().includes(normalizedSearchTerm)
      ),
    [antigravityFiles, normalizedSearchTerm]
  );

  const quotaSelections = useMemo(() => {
    const result = new Map<string, QuotaSelection>();
    antigravityFiles.forEach((file) => {
      const quotaState = antigravityQuota[file.name] as AntigravityQuotaState | undefined;
      result.set(file.name, selectAntigravityCredentialWindow(quotaState, quotaType));
    });
    return result;
  }, [antigravityFiles, antigravityQuota, quotaType]);

  const windowQueries = useMemo<CredentialWindowQuery[]>(
    () =>
      antigravityFiles.flatMap((file) => {
        const selection = quotaSelections.get(file.name);
        if (!selection || selection.start === null || selection.end === null) return [];
        return [
          {
            id: file.name,
            source: getCredentialSourceForFile(file),
            category: quotaType === 'claude' ? 'claude_gpt' : 'gemini',
            start: selection.start,
            end: selection.end,
          },
        ];
      }),
    [antigravityFiles, quotaSelections, quotaType]
  );
  const { summaries: windowSummaries, loading: windowLoading } =
    useCredentialWindowUsage(windowQueries);

  const quotaRows = useMemo(() => {
    const result = new Map<string, QuotaRow>();
    antigravityFiles.forEach((file) => {
      result.set(file.name, {
        group: quotaSelections.get(file.name)?.group ?? null,
        summary: windowSummaries[file.name] ?? null,
      });
    });
    return result;
  }, [antigravityFiles, quotaSelections, windowSummaries]);

  const handleRefreshQuota = useCallback(
    async (file: AuthFileItem) => {
      const quotaKey = file.name;
      if (!quotaKey) return 'skipped' as const;

      setRefreshingKeys((prev) => ({ ...prev, [quotaKey]: true }));
      setAntigravityQuota((prev) => ({
        ...prev,
        [quotaKey]: ANTIGRAVITY_CONFIG.buildLoadingState(),
      }));

      try {
        const data = await ANTIGRAVITY_CONFIG.fetchQuota(file, t);
        setAntigravityQuota((prev) => ({
          ...prev,
          [quotaKey]: ANTIGRAVITY_CONFIG.buildSuccessState(data),
        }));
        return 'success' as const;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? Number((err as { status?: unknown }).status)
            : undefined;
        setAntigravityQuota((prev) => ({
          ...prev,
          [quotaKey]: ANTIGRAVITY_CONFIG.buildErrorState(
            message,
            Number.isFinite(status) ? status : undefined
          ),
        }));
        return 'failed' as const;
      } finally {
        setRefreshingKeys((prev) => ({ ...prev, [quotaKey]: false }));
      }
    },
    [setAntigravityQuota, t]
  );

  const hasFetchedQuota = useCallback(
    (file: AuthFileItem): boolean => {
      const quotaState = antigravityQuota[file.name] as AntigravityQuotaState | undefined;
      return quotaState?.status === 'success' && (quotaState.groups?.length ?? 0) > 0;
    },
    [antigravityQuota]
  );

  const handleBatchRefresh = useCallback(
    async (mode: 'all' | 'missing') => {
      if (progress.running) return;

      const targetFiles =
        mode === 'all'
          ? antigravityFiles
          : antigravityFiles.filter((file) => !hasFetchedQuota(file));
      const intervalMs = getRefreshIntervalMs(refreshIntervalSeconds);
      const total = targetFiles.length;

      setBatchMessage(null);
      setProgress({
        running: total > 0,
        total,
        done: 0,
        success: 0,
        failed: 0,
        mode,
      });

      if (total === 0) {
        setBatchMessage(t('credential_center.codex_pool_batch_none'));
        setProgress(emptyProgress());
        return;
      }

      for (let index = 0; index < targetFiles.length; index += 1) {
        const file = targetFiles[index];
        const result = await handleRefreshQuota(file);
        setProgress((current) => ({
          ...current,
          done: current.done + 1,
          success: current.success + (result === 'success' ? 1 : 0),
          failed: current.failed + (result === 'failed' ? 1 : 0),
        }));
        if (index < targetFiles.length - 1 && intervalMs > 0) {
          await sleep(intervalMs);
        }
      }

      setProgress((current) => ({ ...current, running: false }));
      setBatchMessage(t('credential_center.codex_pool_batch_finished'));
    },
    [
      antigravityFiles,
      hasFetchedQuota,
      handleRefreshQuota,
      progress.running,
      refreshIntervalSeconds,
      t,
    ]
  );

  const missingQuotaCount = useMemo(
    () => antigravityFiles.filter((file) => !hasFetchedQuota(file)).length,
    [antigravityFiles, hasFetchedQuota]
  );

  const progressPercent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const renderQuotaLimit = (
    quotaState: AntigravityQuotaState | undefined,
    group: AntigravityQuotaGroup | null
  ) => {
    if (quotaState?.status === 'loading') {
      return <span className={styles.quotaStatus}>{t('credential_center.quota_loading')}</span>;
    }
    if (quotaState?.status === 'error') {
      return (
        <span className={styles.quotaError} title={quotaState.error}>
          {t('credential_center.quota_error')}
        </span>
      );
    }

    if (!group) return <span className={styles.quotaStatus}>--</span>;

    // Show the longest window's reset (e.g. weekly rather than 5h) to match the quota figure.
    const resetLabel = formatResetLabel(selectLongestWindowBucket(group)?.resetTime);

    return (
      <span className={styles.quotaLimitCellInner} title={resetLabel}>
        <span className={styles.quotaLimitPrimary}>{getRemainingPercentLabel(group)}</span>
        <span className={styles.quotaLimitSecondary}>{resetLabel}</span>
      </span>
    );
  };

  const titleKey =
    quotaType === 'claude'
      ? 'credential_center.antigravity_claude_quota_title'
      : 'credential_center.antigravity_gemini_quota_title';
  const emptyTitleKey =
    quotaType === 'claude'
      ? 'credential_center.antigravity_claude_quota_empty_title'
      : 'credential_center.antigravity_gemini_quota_empty_title';
  const emptyDescKey =
    quotaType === 'claude'
      ? 'credential_center.antigravity_claude_quota_empty_desc'
      : 'credential_center.antigravity_gemini_quota_empty_desc';

  return (
    <Card
      title={t(titleKey)}
      className={`${styles.fixedCard} ${styles.quotaCard}`}
      extra={
        <div className={styles.cardHeaderControls}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleBatchRefresh('all')}
            disabled={progress.running || antigravityFiles.length === 0}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap',
              }}
            >
              <IconRefreshCw size={14} />
              {t('credential_center.codex_pool_refresh_all')}
            </span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleBatchRefresh('missing')}
            disabled={progress.running || missingQuotaCount === 0}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap',
              }}
            >
              <IconRefreshCw size={14} />
              {t('credential_center.codex_pool_refresh_missing')}
            </span>
          </Button>
          <label className={styles.codexPoolIntervalControl}>
            <span>{t('credential_center.codex_pool_refresh_interval')}</span>
            <Input
              type="number"
              min="0"
              step="0.1"
              value={refreshIntervalSeconds}
              onChange={(event) => setRefreshIntervalSeconds(event.currentTarget.value)}
              className={styles.codexPoolIntervalInput}
              aria-label={t('credential_center.codex_pool_refresh_interval')}
            />
            <span>{t('credential_center.codex_pool_refresh_interval_unit')}</span>
          </label>
          <div className={styles.searchFilterItem}>
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.currentTarget.value)}
              placeholder={t('monitoring_center.credential_search_placeholder')}
              aria-label={t('monitoring_center.credential_search_label')}
              className={styles.searchInput}
            />
          </div>
        </div>
      }
    >
      {loading && antigravityFiles.length === 0 ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : antigravityFiles.length === 0 ? (
        <EmptyState title={t(emptyTitleKey)} description={t(emptyDescKey)} />
      ) : filteredAntigravityFiles.length === 0 ? (
        <EmptyState
          title={t('monitoring_center.credential_no_result_title')}
          description={t('monitoring_center.credential_no_result_desc')}
        />
      ) : (
        <>
          {(progress.running || progress.total > 0 || batchMessage) && (
            <div className={styles.codexPoolProgressBox}>
              <div className={styles.codexPoolProgressHeader}>
                <span>
                  {progress.mode
                    ? t(`credential_center.codex_pool_batch_mode_${progress.mode}`)
                    : t('credential_center.codex_pool_batch_progress')}
                </span>
                <span>
                  {progress.done}/{progress.total} · {progressPercent}%
                </span>
              </div>
              <div className={styles.codexPoolProgressTrack}>
                <div
                  className={styles.codexPoolProgressFill}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className={styles.codexPoolProgressMeta}>
                <span>
                  {t('credential_center.codex_pool_progress_success', { count: progress.success })}
                </span>
                <span>
                  {t('credential_center.codex_pool_progress_failed', { count: progress.failed })}
                </span>
                {batchMessage && <span>{batchMessage}</span>}
              </div>
            </div>
          )}
          <div className={styles.tableScroll}>
            <table
              className={`${styles.table} ${styles.codexQuotaTable} ${styles.mobileCardTable}`}
            >
              <thead>
                <tr>
                  <th>{t('credential_center.quota_credential')}</th>
                  <th className={styles.refreshColumn}>
                    <span className={styles.visuallyHidden}>
                      {t('credential_center.quota_refresh')}
                    </span>
                  </th>
                  <th className={styles.quotaLimitColumn}>{t('credential_center.quota_limit')}</th>
                  <th className={styles.quotaRequestColumn}>{t('usage_stats.requests_count')}</th>
                  <th className={styles.quotaTokenColumn}>{t('usage_stats.tokens_count')}</th>
                  <th className={styles.quotaSpendColumn}>{t('credential_center.quota_spend')}</th>
                  <th className={styles.quotaEstimateColumn}>
                    {t('credential_center.quota_estimate')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {windowLoading ? (
                  <tr className={styles.mobileLoadingRow}>
                    <td colSpan={7}>
                      <div className={styles.quotaWindowLoading}>
                        <LoadingSpinner size={20} />
                        <span>{t('common.loading')}</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAntigravityFiles.map((file) => {
                    const quotaState = antigravityQuota[file.name] as
                      AntigravityQuotaState | undefined;
                    const row = quotaRows.get(file.name);
                    const group = row?.group ?? null;
                    const summary = row?.summary ?? null;
                    const estimate = estimateQuotaCost(summary?.cost, group);
                    const isRefreshing = refreshingKeys[file.name] === true;

                    return (
                      <tr key={file.name}>
                        <td
                          className={styles.credentialCell}
                          data-label={t('credential_center.quota_credential')}
                        >
                          {file.name}
                        </td>
                        <td
                          className={styles.refreshCell}
                          data-label={t('credential_center.quota_refresh')}
                        >
                          <span className={styles.refreshCellContent}>
                            <Button
                              variant="secondary"
                              size="sm"
                              className={styles.iconOnlyButton}
                              loading={isRefreshing}
                              onClick={() => void handleRefreshQuota(file)}
                              aria-label={t('credential_center.quota_refresh')}
                              title={t('credential_center.quota_refresh')}
                            >
                              {!isRefreshing && <IconRefreshCw size={14} />}
                            </Button>
                          </span>
                        </td>
                        <td
                          className={styles.quotaLimitColumn}
                          data-label={t('credential_center.quota_limit')}
                        >
                          {renderQuotaLimit(quotaState, group)}
                        </td>
                        <td
                          className={styles.quotaRequestColumn}
                          data-label={t('usage_stats.requests_count')}
                        >
                          {renderRequestCount(summary)}
                        </td>
                        <td
                          className={styles.quotaTokenColumn}
                          data-label={t('usage_stats.tokens_count')}
                        >
                          {summary ? formatCompactNumber(summary.tokens) : '--'}
                        </td>
                        <td
                          className={styles.quotaSpendColumn}
                          data-label={t('credential_center.quota_spend')}
                        >
                          {summary ? formatUsd(summary.cost) : '--'}
                        </td>
                        <td
                          className={styles.quotaEstimateColumn}
                          data-label={t('credential_center.quota_estimate')}
                        >
                          {estimate !== null ? formatUsd(estimate) : '--'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
