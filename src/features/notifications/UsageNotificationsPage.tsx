import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiKeysApi } from '@/services/api/apiKeys';
import {
  usageNotificationsApi,
  type UsageNotificationSettings,
  type UsageSubscription,
  type UsageNotificationHistory,
  type UsageNotificationPeriod,
} from '@/services/api/notifications';
import { useAuthStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import {
  emptySubscription,
  maskNotificationKey,
  notificationCost,
  notificationTime,
  notificationTimezone,
} from './logic';
import styles from './UsageNotificationsPage.module.scss';

export function UsageNotificationsPage() {
  const { t, i18n } = useTranslation();
  const text = (key: string) => t(`usage_notifications.${key}`);
  const connected = useAuthStore((s) => s.connectionStatus === 'connected');
  const showNotification = useNotificationStore((s) => s.showNotification);
  const showConfirmation = useNotificationStore((s) => s.showConfirmation);
  const [settings, setSettings] = useState<UsageNotificationSettings | null>(null);
  const [subscriptions, setSubscriptions] = useState<UsageSubscription[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [history, setHistory] = useState<UsageNotificationHistory>({ current: [], periods: [] });
  const [historyRevision, refreshHistory] = useReducer((revision: number) => revision + 1, 0);
  const [draft, setDraft] = useState<UsageSubscription | null>(null);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const historyGeneration = useRef(0);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!connected) {
      setLoading(false);
      setSettings(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [cfg, result, availableKeys] = await Promise.all([
        usageNotificationsApi.settings(),
        usageNotificationsApi.subscriptions(),
        apiKeysApi.list(),
      ]);
      if (generation !== loadGeneration.current) return;
      setSettings({ ...cfg, timezone: notificationTimezone(cfg) });
      setSubscriptions(result.subscriptions);
      setKeys(availableKeys);
      setSelected((id) =>
        result.subscriptions.some((s) => s.id === id) ? id : (result.subscriptions[0]?.id ?? '')
      );
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setError(
        (e as { status?: number }).status === 404
          ? t('usage_notifications.unavailable')
          : getErrorMessage(e, t('usage_notifications.failed'))
      );
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [connected, t]);

  const loadHistory = useCallback(async () => {
    const generation = ++historyGeneration.current;
    setHistory({ current: [], periods: [] });
    setHistoryError('');
    if (!selected || !connected) {
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    try {
      const result = await usageNotificationsApi.history(selected);
      if (generation === historyGeneration.current) setHistory(result);
    } catch (e) {
      if (generation === historyGeneration.current)
        setHistoryError(getErrorMessage(e, t('usage_notifications.failed')));
    } finally {
      if (generation === historyGeneration.current) setHistoryLoading(false);
    }
  }, [selected, connected, t]);

  useEffect(() => {
    const generation = loadGeneration;
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    const generation = historyGeneration;
    void loadHistory();
    return () => {
      generation.current++;
    };
  }, [loadHistory, historyRevision]);
  const refresh = useCallback(async () => {
    refreshHistory();
    await load();
  }, [load]);
  useHeaderRefresh(refresh, connected && !busy);

  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      showNotification(text('saved'), 'success');
    } catch (e) {
      showNotification(getErrorMessage(e, text('failed')), 'error');
    } finally {
      setBusy(false);
    }
  };
  const update = <K extends keyof UsageNotificationSettings>(
    key: K,
    value: UsageNotificationSettings[K]
  ) => setSettings((old) => (old ? { ...old, [key]: value } : old));
  const save = () =>
    action(async () => {
      if (!settings) return;
      setSettings(await usageNotificationsApi.saveSettings(settings, password, clearPassword));
      setPassword('');
      setClearPassword(false);
      refreshHistory();
    });
  const confirm = (title: string, message: string, fn: () => Promise<void>) =>
    showConfirmation({ title, message, onConfirm: () => action(fn) });
  const time = (unix: number, zone: string) => notificationTime(unix, zone, i18n.language);
  const periods = (items: UsageNotificationPeriod[]) =>
    !items.length ? (
      <p className={styles.muted}>{text('empty')}</p>
    ) : (
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {['period', 'cost', 'requests', 'tokens', 'status', 'actions'].map((key) => (
                <th key={key}>{text(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td data-label={text('period')}>
                  <div>
                    {time(p.start, p.timezone)} — {time(p.end, p.timezone)}
                  </div>
                  <small>
                    {p.timezone} · {p.email}
                  </small>
                  {p.partial && <div>{text('partial')}</div>}
                </td>
                <td data-label={text('cost')}>
                  {notificationCost(p)}
                  {p.unpriced_requests > 0 && (
                    <small>
                      {t('usage_notifications.unpriced', { count: p.unpriced_requests })}
                    </small>
                  )}
                </td>
                <td data-label={text('requests')}>{p.requests.toLocaleString()}</td>
                <td data-label={text('tokens')}>{p.tokens.toLocaleString()}</td>
                <td data-label={text('status')}>
                  {text(`states.${p.status}`)}
                  {p.error && <small>{p.error}</small>}
                  {p.skipped_cycles > 0 && (
                    <small>
                      {t('usage_notifications.skipped_cycles', { count: p.skipped_cycles })}
                    </small>
                  )}
                </td>
                <td data-label={text('actions')}>
                  {(p.status === 'failed' || p.status === 'unknown') && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        confirm(text('retry'), text('retry_confirm'), async () => {
                          await usageNotificationsApi.retry(p.id);
                          refreshHistory();
                        })
                      }
                    >
                      {text('retry')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{text('title')}</h1>
          <p>{text('description')}</p>
        </div>
        <Button
          variant="secondary"
          disabled={!connected || busy || loading}
          onClick={() => void refresh()}
        >
          {text('refresh')}
        </Button>
      </header>
      <p className={styles.muted}>{text('rules')}</p>
      {!connected && <p role="alert">{text('connected')}</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {loading && <p role="status">{text('loading')}</p>}
      {settings && connected && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy || loading} className={styles.fieldset}>
              <div className={styles.columns}>
                <Card title={text('schedule')}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={settings.enabled}
                      onChange={(e) => update('enabled', e.target.checked)}
                    />
                    {text('enabled')}
                  </label>
                  <div className="form-group">
                    <label htmlFor="notification-frequency">{text('frequency')}</label>
                    <Select
                      id="notification-frequency"
                      value={settings.frequency}
                      onChange={(v) => update('frequency', v as 'daily' | 'weekly')}
                      options={['daily', 'weekly'].map((v) => ({ value: v, label: text(v) }))}
                    />
                  </div>
                  {settings.frequency === 'weekly' && (
                    <div className="form-group">
                      <label htmlFor="notification-weekday">{text('weekday')}</label>
                      <Select
                        id="notification-weekday"
                        value={String(settings.weekday)}
                        onChange={(v) => update('weekday', Number(v))}
                        options={Array.from({ length: 7 }, (_, day) => ({
                          value: String(day),
                          label: text(`weekdays.${day}`),
                        }))}
                      />
                    </div>
                  )}
                  <Input
                    label={text('time')}
                    type="time"
                    step={60}
                    required
                    value={`${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')}`}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const [hour, minute] = e.target.value.split(':').map(Number);
                      setSettings({ ...settings, hour, minute });
                    }}
                  />
                  <Input
                    label={text('timezone')}
                    required
                    value={settings.timezone}
                    placeholder="Asia/Shanghai"
                    onChange={(e) => update('timezone', e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      update('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
                    }
                  >
                    {text('use_local_timezone')}
                  </Button>
                  <p className={styles.muted}>
                    {text('next')}:{' '}
                    {settings.next_at ? time(settings.next_at, settings.timezone) : '—'}
                  </p>
                </Card>
                <Card title={text('smtp')}>
                  <Input
                    label={text('sender')}
                    type="email"
                    value={settings.sender}
                    onChange={(e) => update('sender', e.target.value)}
                  />
                  <Input
                    label={text('password')}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    placeholder={text(
                      settings.password_configured ? 'configured' : 'not_configured'
                    )}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={clearPassword}
                      onChange={(e) => setClearPassword(e.target.checked)}
                    />
                    {text('clear_password')}
                  </label>
                  <p className={styles.muted}>{text('smtp_hint')}</p>
                  <p className={styles.muted}>{text('security')}</p>
                </Card>
              </div>
              <Button type="submit" disabled={busy}>
                {text('save')}
              </Button>
            </fieldset>
          </form>
          <Card title={text('test')}>
            <form
              className={styles.testForm}
              onSubmit={(e) => {
                e.preventDefault();
                confirm(
                  text('test'),
                  t('usage_notifications.test_confirm', { email: recipient }),
                  async () => {
                    await usageNotificationsApi.testEmail(recipient);
                  }
                );
              }}
            >
              <Input
                label={text('test_recipient')}
                type="email"
                required
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
              <Button type="submit" disabled={busy}>
                {text('test')}
              </Button>
            </form>
          </Card>
          <Card
            title={text('subscriptions')}
            extra={
              <Button disabled={busy} onClick={() => setDraft(emptySubscription())}>
                {text('add')}
              </Button>
            }
          >
            {!subscriptions.length && <p>{text('empty')}</p>}
            <div className={styles.bindings}>
              {subscriptions.map((sub) => (
                <div key={sub.id} className={styles.binding}>
                  <button
                    type="button"
                    className={styles.selectBinding}
                    aria-pressed={selected === sub.id}
                    onClick={() => setSelected(sub.id)}
                  >
                    <strong>{sub.note || sub.key_label}</strong>
                    <span>
                      {sub.note ? `${sub.key_label} · ` : ''}
                      {sub.email}
                    </span>
                  </button>
                  <span>
                    {text(sub.deleted ? 'deleted' : sub.enabled ? 'active' : 'paused')}
                    {!sub.deleted && !keys.includes(sub.api_key) && (
                      <small>{text('missing')}</small>
                    )}
                  </span>
                  {!sub.deleted && (
                    <div className={styles.actions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => setDraft({ ...sub })}
                      >
                        {text('edit')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          confirm(text('remove'), text('remove_confirm'), async () => {
                            await usageNotificationsApi.removeSubscription(sub.id);
                            await refresh();
                          })
                        }
                      >
                        {text('remove')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
          {selected && (
            <section aria-busy={historyLoading}>
              {historyError && (
                <p role="alert" className={styles.error}>
                  {historyError}
                </p>
              )}
              {historyLoading ? (
                <p role="status">{text('loading')}</p>
              ) : (
                <>
                  <Card title={text('current')}>{periods(history.current)}</Card>
                  <Card title={text('history')}>{periods(history.periods)}</Card>
                </>
              )}
            </section>
          )}
        </>
      )}
      <Modal
        open={draft !== null}
        onClose={() => {
          if (!busy) setDraft(null);
        }}
        title={text(draft?.id ? 'edit' : 'add')}
      >
        {draft && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const result = await usageNotificationsApi.saveSubscription(draft);
                setDraft(null);
                await load();
                setSelected(result.id);
                refreshHistory();
              });
            }}
          >
            <div className="form-group">
              <label htmlFor="notification-key">{text('select_key')}</label>
              <Select
                id="notification-key"
                disabled={Boolean(draft.id)}
                value={draft.api_key}
                placeholder={text('select_key')}
                options={[...new Set([...keys, ...(draft.api_key ? [draft.api_key] : [])])].map(
                  (key) => ({ value: key, label: maskNotificationKey(key) })
                )}
                onChange={(key) => setDraft({ ...draft, api_key: key })}
              />
            </div>
            <Input
              label={text('email')}
              type="email"
              required
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
            <Input
              label={text('note')}
              maxLength={100}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              {text('enabled')}
            </label>
            <div className={styles.actions}>
              <Button type="submit" disabled={busy || !draft.api_key}>
                {text('save')}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setDraft(null)}>
                {text('cancel')}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
