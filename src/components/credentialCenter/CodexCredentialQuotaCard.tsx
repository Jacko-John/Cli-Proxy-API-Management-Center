import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CODEX_CONFIG } from '@/features/quota/providers/codex/data';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconRefreshCw } from '@/components/ui/icons';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem, CodexQuotaState, CodexQuotaWindow } from '@/types';
import {
  getCredentialSourceForFile,
  type CredentialWindowUsageSummary,
} from '@/utils/credentialUsage';
import { formatCompactNumber, formatUsd } from '@/utils/usage';
import { useCredentialWindowUsage } from './useCredentialWindowUsage';
import { isCodexFile } from '@/utils/quota';
import styles from '@/pages/CredentialCenterPage.module.scss';

const HOUR_MS = 60 * 60 * 1000;

const WINDOW_MS_BY_ID: Record<string, number> = {
  'five-hour': 5 * HOUR_MS,
  weekly: 7 * 24 * HOUR_MS,
  monthly: 30 * 24 * HOUR_MS,
};

interface CodexCredentialQuotaCardProps {
  loading: boolean;
  authFiles: AuthFileItem[];
}

interface SelectedQuotaWindow {
  window: CodexQuotaWindow;
}

const getWindowDurationMs = (window: CodexQuotaWindow | undefined): number | null => {
  if (!window) return null;
  if (
    typeof window.periodHours === 'number' &&
    Number.isFinite(window.periodHours) &&
    window.periodHours > 0
  ) {
    return window.periodHours * HOUR_MS;
  }
  return WINDOW_MS_BY_ID[window.id] ?? null;
};

const selectMaxQuotaWindow = (
  quotaState: CodexQuotaState | undefined
): SelectedQuotaWindow | null => {
  const windows = quotaState?.windows ?? [];
  let selected: SelectedQuotaWindow | null = null;
  let selectedDurationMs = -1;

  windows.forEach((window) => {
    const durationMs = getWindowDurationMs(window) ?? 0;
    if (durationMs > selectedDurationMs) {
      selected = { window };
      selectedDurationMs = durationMs;
    }
  });

  return selected;
};

const getRemainingPercentValue = (window: CodexQuotaWindow | undefined): number | null => {
  if (!window || typeof window.usedPercent !== 'number') return null;
  return Math.max(0, Math.min(100, 100 - window.usedPercent));
};

const getRemainingPercentLabel = (window: CodexQuotaWindow): string => {
  const remainingPercent = getRemainingPercentValue(window);
  return remainingPercent === null ? '--' : `${Math.round(remainingPercent)}%`;
};

const estimateQuotaCost = (
  cost: number | null | undefined,
  window: CodexQuotaWindow | undefined
): number | null => {
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null;
  const remainingPercent = getRemainingPercentValue(window);
  if (remainingPercent === null) return null;
  const usedRatio = 1 - remainingPercent / 100;
  if (usedRatio <= 0) return null;
  return cost / usedRatio;
};

const getWindowEndMs = (window: CodexQuotaWindow | undefined): number | null => {
  const endMs = window?.resetAtMs;
  return typeof endMs === 'number' && Number.isFinite(endMs) && endMs > 0 ? endMs : null;
};

const renderRequestCount = (summary: CredentialWindowUsageSummary | null | undefined) => {
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

export function CodexCredentialQuotaCard({ loading, authFiles }: CodexCredentialQuotaCardProps) {
  const { t } = useTranslation();
  const [refreshingKeys, setRefreshingKeys] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(
    DEFAULT_REFRESH_INTERVAL_SECONDS
  );
  const [progress, setProgress] = useState<BatchProgress>(emptyProgress);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [hiddenRevealed, setHiddenRevealed] = useState(false);
  const [batchNamesText, setBatchNamesText] = useState('');
  const titleClickRef = useRef<{ count: number; last: number }>({ count: 0, last: 0 });

  const handleTitleClick = useCallback(() => {
    const now = Date.now();
    const ref = titleClickRef.current;
    if (now - ref.last > 2000) {
      ref.count = 0;
    }
    ref.count += 1;
    ref.last = now;
    if (ref.count >= 5) {
      ref.count = 0;
      setHiddenRevealed((prev) => !prev);
    }
  }, []);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const setCodexQuota = useQuotaStore((state) => state.setCodexQuota);

  const codexFiles = useMemo(
    () => authFiles.filter((file) => file.name && isCodexFile(file)),
    [authFiles]
  );
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredCodexFiles = useMemo(
    () =>
      codexFiles.filter(
        (file) => !normalizedSearchTerm || file.name.toLowerCase().includes(normalizedSearchTerm)
      ),
    [codexFiles, normalizedSearchTerm]
  );

  const quotaSelections = useMemo(() => {
    const result = new Map<
      string,
      { selected: SelectedQuotaWindow | null; start: number | null; end: number | null }
    >();
    codexFiles.forEach((file) => {
      const quotaState = codexQuota[file.name] as CodexQuotaState | undefined;
      const selected = selectMaxQuotaWindow(quotaState);
      const endMs = getWindowEndMs(selected?.window);
      const windowMs = getWindowDurationMs(selected?.window);
      result.set(file.name, {
        selected,
        start: endMs !== null && windowMs !== null ? Math.floor((endMs - windowMs) / 1000) : null,
        end: endMs !== null ? Math.floor(endMs / 1000) : null,
      });
    });
    return result;
  }, [codexFiles, codexQuota]);

  const windowQueries = useMemo(
    () =>
      codexFiles.flatMap((file) => {
        const selection = quotaSelections.get(file.name);
        if (selection?.start === null || selection?.end === null || !selection) return [];
        return [
          {
            id: file.name,
            source: getCredentialSourceForFile(file),
            category: 'all' as const,
            start: selection.start,
            end: selection.end,
          },
        ];
      }),
    [codexFiles, quotaSelections]
  );
  const { summaries: windowSummaries, loading: windowLoading } =
    useCredentialWindowUsage(windowQueries);

  const quotaRows = useMemo(() => {
    const result = new Map<
      string,
      { selected: SelectedQuotaWindow | null; summary: CredentialWindowUsageSummary | null }
    >();
    codexFiles.forEach((file) => {
      result.set(file.name, {
        selected: quotaSelections.get(file.name)?.selected ?? null,
        summary: windowSummaries[file.name] ?? null,
      });
    });
    return result;
  }, [codexFiles, quotaSelections, windowSummaries]);

  const handleRefreshQuota = useCallback(
    async (file: AuthFileItem) => {
      const quotaKey = file.name;
      if (!quotaKey) return 'skipped' as const;

      setRefreshingKeys((prev) => ({ ...prev, [quotaKey]: true }));
      setCodexQuota((prev) => ({
        ...prev,
        [quotaKey]: CODEX_CONFIG.buildLoadingState(),
      }));

      try {
        const data = await CODEX_CONFIG.fetchQuota(file, t);
        setCodexQuota((prev) => ({
          ...prev,
          [quotaKey]: CODEX_CONFIG.buildSuccessState(data),
        }));
        return 'success' as const;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? Number((err as { status?: unknown }).status)
            : undefined;
        setCodexQuota((prev) => ({
          ...prev,
          [quotaKey]: CODEX_CONFIG.buildErrorState(
            message,
            Number.isFinite(status) ? status : undefined
          ),
        }));
        return 'failed' as const;
      } finally {
        setRefreshingKeys((prev) => ({ ...prev, [quotaKey]: false }));
      }
    },
    [setCodexQuota, t]
  );

  const hasFetchedQuota = useCallback(
    (file: AuthFileItem): boolean => {
      const quotaState = codexQuota[file.name] as CodexQuotaState | undefined;
      return quotaState?.status === 'success' && (quotaState.windows?.length ?? 0) > 0;
    },
    [codexQuota]
  );

  const handleBatchRefresh = useCallback(
    async (mode: 'all' | 'missing') => {
      if (progress.running) return;

      const targetFiles =
        mode === 'all' ? codexFiles : codexFiles.filter((file) => !hasFetchedQuota(file));
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
    [codexFiles, hasFetchedQuota, handleRefreshQuota, progress.running, refreshIntervalSeconds, t]
  );

  const handleBatchRefreshByNames = useCallback(async () => {
    if (progress.running) return;

    const names = Array.from(
      new Set(
        batchNamesText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      )
    );

    if (names.length === 0) {
      setBatchMessage('请输入凭证名称');
      return;
    }

    const fileByName = new Map(codexFiles.map((file) => [file.name, file]));
    const targetFiles: AuthFileItem[] = [];
    const notFound: string[] = [];
    names.forEach((name) => {
      const file = fileByName.get(name);
      if (file) {
        targetFiles.push(file);
      } else {
        notFound.push(name);
      }
    });

    const intervalMs = getRefreshIntervalMs(refreshIntervalSeconds);
    const total = targetFiles.length;

    setBatchMessage(null);
    setProgress({ running: total > 0, total, done: 0, success: 0, failed: 0, mode: null });

    if (total === 0) {
      setProgress(emptyProgress());
      setBatchMessage(`未匹配到任何凭证（${notFound.length} 个无效名称）`);
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
    setBatchMessage(
      notFound.length > 0
        ? `刷新完成，${notFound.length} 个名称未匹配：${notFound.join('、')}`
        : '刷新完成'
    );
  }, [batchNamesText, codexFiles, handleRefreshQuota, progress.running, refreshIntervalSeconds]);

  const missingQuotaCount = useMemo(
    () => codexFiles.filter((file) => !hasFetchedQuota(file)).length,
    [codexFiles, hasFetchedQuota]
  );

  const progressPercent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const renderQuotaLimit = (
    quotaState: CodexQuotaState | undefined,
    selected: SelectedQuotaWindow | null
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

    const window = selected?.window;
    if (!window) return <span className={styles.quotaStatus}>--</span>;

    return (
      <span className={styles.quotaLimitCellInner} title={window.resetLabel}>
        <span className={styles.quotaLimitPrimary}>{getRemainingPercentLabel(window)}</span>
        <span className={styles.quotaLimitSecondary}>{window.resetLabel}</span>
      </span>
    );
  };

  return (
    <Card
      title={
        <span onClick={handleTitleClick} style={{ cursor: 'default', userSelect: 'none' }}>
          {t('credential_center.codex_quota_title')}
        </span>
      }
      className={`${styles.fixedCard} ${styles.quotaCard}`}
      extra={
        <div className={styles.cardHeaderControls}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleBatchRefresh('all')}
            disabled={progress.running || codexFiles.length === 0}
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
      {hiddenRevealed && (
        <div className={styles.codexHiddenBatchBox}>
          <textarea
            className={styles.codexHiddenBatchTextarea}
            value={batchNamesText}
            onChange={(event) => setBatchNamesText(event.currentTarget.value)}
            placeholder={'每行一个凭证名称'}
            rows={6}
            spellCheck={false}
          />
          <div className={styles.codexHiddenBatchActions}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleBatchRefreshByNames()}
              disabled={progress.running}
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
                刷新
              </span>
            </Button>
          </div>
        </div>
      )}
      {loading && codexFiles.length === 0 ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : codexFiles.length === 0 ? (
        <EmptyState
          title={t('credential_center.codex_quota_empty_title')}
          description={t('credential_center.codex_quota_empty_desc')}
        />
      ) : filteredCodexFiles.length === 0 ? (
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
                  filteredCodexFiles.map((file) => {
                    const quotaState = codexQuota[file.name] as CodexQuotaState | undefined;
                    const row = quotaRows.get(file.name);
                    const selectedWindow = row?.selected?.window;
                    const summary = row?.summary ?? null;
                    const estimate = estimateQuotaCost(summary?.cost, selectedWindow);
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
                          {renderQuotaLimit(quotaState, row?.selected ?? null)}
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
