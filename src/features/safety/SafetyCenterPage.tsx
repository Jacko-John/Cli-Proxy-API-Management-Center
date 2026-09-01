import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconRefreshCw,
  IconShield,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { usageSafetyApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { SafetyHistoryItem, SafetyHistoryStatus, SafetyKeyStatus } from '@/types/usageSafety';
import { getErrorMessage } from '@/utils/helpers';
import {
  formatSafetyFailureBody,
  historyCursor,
  sortSafetyKeys,
  summarizeSafetyKeys,
} from './logic';
import styles from './SafetyCenterPage.module.scss';

const HISTORY_PAGE_SIZE = 50;

const formatUnixTime = (seconds: number): string =>
  seconds > 0 ? new Date(seconds * 1000).toLocaleString() : '—';

const statusClassName = (status: SafetyHistoryStatus): string => {
  if (status === 'active') return styles.statusDanger;
  if (status === 'manual_released') return styles.statusSuccess;
  if (status === 'expired') return styles.statusMuted;
  return styles.statusNeutral;
};

export function SafetyCenterPage() {
  const { t } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [keys, setKeys] = useState<SafetyKeyStatus[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [keysLoading, setKeysLoading] = useState(true);
  const [keysError, setKeysError] = useState('');
  const [history, setHistory] = useState<SafetyHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pendingAction, setPendingAction] = useState('');
  const historyRequestRef = useRef(0);

  const loadKeys = useCallback(async () => {
    if (!connected) {
      setKeys([]);
      setSelectedKey('');
      setKeysLoading(false);
      setKeysError(t('safety_center.connection_required'));
      return;
    }

    setKeysLoading(true);
    setKeysError('');
    try {
      const response = await usageSafetyApi.getKeys();
      const nextKeys = sortSafetyKeys(response.keys ?? []);
      setKeys(nextKeys);
      setSelectedKey((current) =>
        current && nextKeys.some((item) => item.api_key === current)
          ? current
          : (nextKeys[0]?.api_key ?? '')
      );
    } catch (error: unknown) {
      setKeysError(getErrorMessage(error, t('safety_center.load_failed')));
    } finally {
      setKeysLoading(false);
    }
  }, [connected, t]);

  const loadHistory = useCallback(
    async (
      apiKey: string,
      onlyLimited: boolean,
      cursor?: { before_time: number; before_id: string }
    ) => {
      const append = Boolean(cursor);
      const requestID = ++historyRequestRef.current;
      if (append) {
        setHistoryLoadingMore(true);
      } else {
        setHistoryLoading(true);
        setHistoryError('');
      }

      try {
        const response = await usageSafetyApi.getHistory({
          api_key: apiKey,
          blocked_only: onlyLimited,
          limit: HISTORY_PAGE_SIZE,
          ...cursor,
        });
        if (requestID !== historyRequestRef.current) return;
        const records = response.history ?? [];
        setHistory((current) => (append ? [...current, ...records] : records));
        setHasMore(records.length === HISTORY_PAGE_SIZE);
      } catch (error: unknown) {
        if (requestID !== historyRequestRef.current) return;
        setHistoryError(getErrorMessage(error, t('safety_center.history_load_failed')));
        if (!append) setHistory([]);
      } finally {
        if (requestID === historyRequestRef.current) {
          setHistoryLoading(false);
          setHistoryLoadingMore(false);
        }
      }
    },
    [t]
  );

  const refresh = useCallback(async () => {
    await loadKeys();
    if (selectedKey) {
      await loadHistory(selectedKey, blockedOnly);
    }
  }, [blockedOnly, loadHistory, loadKeys, selectedKey]);

  useHeaderRefresh(refresh, connected);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    if (!selectedKey) {
      historyRequestRef.current += 1;
      setHistory([]);
      setHistoryError('');
      setHasMore(false);
      return;
    }
    void loadHistory(selectedKey, blockedOnly);
  }, [blockedOnly, loadHistory, selectedKey]);

  const summary = useMemo(() => summarizeSafetyKeys(keys), [keys]);
  const selectedState = useMemo(
    () => keys.find((item) => item.api_key === selectedKey),
    [keys, selectedKey]
  );

  const refreshKey = useCallback(
    async (apiKey: string) => {
      await loadKeys();
      if (selectedKey === apiKey) {
        await loadHistory(apiKey, blockedOnly);
      }
    },
    [blockedOnly, loadHistory, loadKeys, selectedKey]
  );

  const releaseKey = useCallback(
    (key: SafetyKeyStatus) => {
      showConfirmation({
        title: t('safety_center.release_title'),
        message: t('safety_center.release_confirm', { apiKey: key.api_key }),
        confirmText: t('safety_center.release'),
        onConfirm: async () => {
          setPendingAction(`release:${key.api_key}`);
          try {
            const result = await usageSafetyApi.releaseLimits([key.api_key]);
            if (result.released.includes(key.api_key)) {
              showNotification(t('safety_center.release_success'), 'success');
            } else {
              showNotification(t('safety_center.release_not_blocked'), 'warning');
            }
            await refreshKey(key.api_key);
          } catch (error: unknown) {
            const message = getErrorMessage(error, t('safety_center.release_failed'));
            showNotification(`${t('safety_center.release_failed')}: ${message}`, 'error');
            throw error;
          } finally {
            setPendingAction('');
          }
        },
      });
    },
    [refreshKey, showConfirmation, showNotification, t]
  );

  const setManualDisabled = useCallback(
    (key: SafetyKeyStatus, disabled: boolean) => {
      const operation = disabled ? 'disable' : 'enable';
      showConfirmation({
        title: t(`safety_center.${operation}_title`),
        message: t(`safety_center.${operation}_confirm`, { apiKey: key.api_key }),
        confirmText: t(`safety_center.${operation}`),
        ...(disabled ? { variant: 'danger' as const } : {}),
        onConfirm: async () => {
          setPendingAction(`${operation}:${key.api_key}`);
          try {
            const changed = disabled
              ? (await usageSafetyApi.disableKeys([key.api_key])).disabled.includes(key.api_key)
              : (await usageSafetyApi.enableKeys([key.api_key])).enabled.includes(key.api_key);
            showNotification(
              t(`safety_center.${operation}_${changed ? 'success' : 'unchanged'}`),
              changed ? 'success' : 'warning'
            );
            await refreshKey(key.api_key);
          } catch (error: unknown) {
            const fallback = t(`safety_center.${operation}_failed`);
            showNotification(`${fallback}: ${getErrorMessage(error, fallback)}`, 'error');
            throw error;
          } finally {
            setPendingAction('');
          }
        },
      });
    },
    [refreshKey, showConfirmation, showNotification, t]
  );

  const loadMore = () => {
    const cursor = historyCursor(history);
    if (selectedKey && cursor) {
      void loadHistory(selectedKey, blockedOnly, cursor);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>{t('safety_center.title')}</h1>
          <p className={styles.description}>{t('safety_center.description')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} loading={keysLoading}>
          <IconRefreshCw size={16} />
          {t('safety_center.refresh')}
        </Button>
      </header>

      {keysError ? <div className={styles.errorBox}>{keysError}</div> : null}

      <section className={styles.summaryGrid} aria-label={t('safety_center.summary')}>
        <article className={styles.summaryCard}>
          <IconShield size={20} />
          <span>{t('safety_center.key_count')}</span>
          <strong>{summary.keys}</strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryDanger}`}>
          <IconShield size={20} />
          <span>{t('safety_center.manual_disabled_count')}</span>
          <strong>{summary.disabledKeys}</strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryDanger}`}>
          <IconAlertTriangle size={20} />
          <span>{t('safety_center.active_limits')}</span>
          <strong>{summary.activeLimits}</strong>
        </article>
        <article className={styles.summaryCard}>
          <IconAlertTriangle size={20} />
          <span>{t('safety_center.total_triggers')}</span>
          <strong>{summary.totalTriggers}</strong>
        </article>
        <article className={styles.summaryCard}>
          <IconCheckCircle2 size={20} />
          <span>{t('safety_center.total_limits')}</span>
          <strong>{summary.totalLimits}</strong>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>{t('safety_center.keys_title')}</h2>
            <p>{t('safety_center.keys_description')}</p>
          </div>
        </div>

        {keysLoading && keys.length === 0 ? (
          <div className={styles.loadingState}>
            <LoadingSpinner size={24} />
            <span>{t('common.loading')}</span>
          </div>
        ) : keys.length === 0 ? (
          <EmptyState
            title={t('safety_center.keys_empty_title')}
            description={t('safety_center.keys_empty_desc')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('safety_center.api_key')}</TableHead>
                <TableHead alignRight>{t('safety_center.window_triggers')}</TableHead>
                <TableHead alignRight>{t('safety_center.total_triggers')}</TableHead>
                <TableHead alignRight>{t('safety_center.total_limits')}</TableHead>
                <TableHead>{t('safety_center.state')}</TableHead>
                <TableHead alignRight>{t('safety_center.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.api_key} selected={key.api_key === selectedKey}>
                  <TableCell>
                    <button
                      type="button"
                      className={styles.keyButton}
                      onClick={() => setSelectedKey(key.api_key)}
                      title={key.api_key}
                    >
                      {key.api_key}
                    </button>
                  </TableCell>
                  <TableCell alignRight>{key.window_trigger_count}</TableCell>
                  <TableCell alignRight>{key.total_trigger_count}</TableCell>
                  <TableCell alignRight>{key.total_limit_count}</TableCell>
                  <TableCell>
                    <div className={styles.stateCell}>
                      <span
                        className={
                          key.manual_disabled
                            ? styles.disabledBadge
                            : key.blocked
                              ? styles.blockedBadge
                              : styles.normalBadge
                        }
                      >
                        {key.manual_disabled
                          ? t('safety_center.manual_disabled')
                          : key.blocked
                            ? t('safety_center.blocked')
                            : t('safety_center.not_blocked')}
                      </span>
                      {key.blocked ? (
                        <small>
                          {t(
                            key.manual_disabled
                              ? 'safety_center.automatic_blocked_until'
                              : 'safety_center.blocked_until'
                          )}
                          : {formatUnixTime(key.blocked_until)}
                        </small>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell alignRight>
                    <div className={styles.actionButtons}>
                      {key.manual_disabled ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setManualDisabled(key, false)}
                          loading={pendingAction === `enable:${key.api_key}`}
                          disabled={Boolean(pendingAction)}
                        >
                          {t('safety_center.enable')}
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setManualDisabled(key, true)}
                            loading={pendingAction === `disable:${key.api_key}`}
                            disabled={Boolean(pendingAction)}
                          >
                            {t('safety_center.disable')}
                          </Button>
                          {key.blocked ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => releaseKey(key)}
                              loading={pendingAction === `release:${key.api_key}`}
                              disabled={Boolean(pendingAction)}
                            >
                              {t('safety_center.release')}
                            </Button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.historyHeading}>
            <h2>{t('safety_center.history_title')}</h2>
            {selectedState ? (
              <code title={selectedState.api_key}>
                {t('safety_center.current_api_key')}: {selectedState.api_key}
              </code>
            ) : null}
          </div>
          <div className={styles.filterButtons}>
            <Button
              variant={!blockedOnly ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setBlockedOnly(false)}
            >
              {t('safety_center.history_all')}
            </Button>
            <Button
              variant={blockedOnly ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setBlockedOnly(true)}
            >
              {t('safety_center.history_limited_only')}
            </Button>
          </div>
        </div>

        {historyError ? <div className={styles.errorBox}>{historyError}</div> : null}

        {!selectedKey ? (
          <EmptyState
            title={t('safety_center.history_no_key_title')}
            description={t('safety_center.history_no_key_desc')}
          />
        ) : historyLoading ? (
          <div className={styles.loadingState}>
            <LoadingSpinner size={24} />
            <span>{t('common.loading')}</span>
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            title={t('safety_center.history_empty_title')}
            description={t('safety_center.history_empty_desc')}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('safety_center.occurred_at')}</TableHead>
                  <TableHead>{t('safety_center.status')}</TableHead>
                  <TableHead>{t('safety_center.provider_model')}</TableHead>
                  <TableHead alignRight>{t('safety_center.http_status')}</TableHead>
                  <TableHead>{t('safety_center.failure')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((item) => {
                  const failureBody = formatSafetyFailureBody(item.failure_body);
                  return (
                    <TableRow key={`${item.occurred_at}:${item.usage_record_id}`}>
                      <TableCell className={styles.timeCell}>
                        {formatUnixTime(item.occurred_at)}
                      </TableCell>
                      <TableCell>
                        <span className={`${styles.historyStatus} ${statusClassName(item.status)}`}>
                          {t(`safety_center.status_${item.status}`)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className={styles.modelCell}>
                          <strong>{item.model || '—'}</strong>
                          <span>{item.provider || '—'}</span>
                        </div>
                      </TableCell>
                      <TableCell alignRight>{item.failure_status_code || '—'}</TableCell>
                      <TableCell className={styles.failureCell}>
                        {failureBody ? (
                          <pre>{failureBody}</pre>
                        ) : (
                          <span className={styles.muted}>{t('safety_center.no_failure_body')}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {hasMore ? (
              <div className={styles.loadMore}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={loadMore}
                  loading={historyLoadingMore}
                >
                  {t('safety_center.load_more')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
