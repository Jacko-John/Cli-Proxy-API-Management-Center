import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { UsageNotificationPeriod } from '@/services/api/notifications';
import { notificationCost, notificationTime } from './logic';
import { NotificationUsageDetails } from './NotificationUsageDetails';
import styles from './NotificationPeriods.module.scss';

interface NotificationPeriodsProps {
  items: UsageNotificationPeriod[];
  busy: boolean;
  onRetry: (period: UsageNotificationPeriod) => void;
}

export function NotificationPeriods({ items, busy, onRetry }: NotificationPeriodsProps) {
  const { t, i18n } = useTranslation();
  const text = (key: string) => t(`usage_notifications.${key}`);
  const time = (unix: number, zone: string) => notificationTime(unix, zone, i18n.language);

  if (!items.length) return <p className={styles.muted}>{text('empty')}</p>;

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {['period', 'cost', 'requests', 'tokens', 'status', 'actions'].map((key) => (
              <th key={key} scope="col">
                {text(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((period) => (
            <Fragment key={period.id}>
              <tr className={styles.periodRow}>
                <td data-label={text('period')}>
                  <div>
                    {time(period.start, period.timezone)} — {time(period.end, period.timezone)}
                  </div>
                  <small>
                    {period.timezone} · {period.email}
                  </small>
                  {period.partial && <div>{text('partial')}</div>}
                </td>
                <td data-label={text('cost')}>
                  {notificationCost(period)}
                  {period.unpriced_requests > 0 && (
                    <small>
                      {t('usage_notifications.unpriced', { count: period.unpriced_requests })}
                    </small>
                  )}
                </td>
                <td data-label={text('requests')}>
                  {period.requests.toLocaleString(i18n.language)}
                </td>
                <td data-label={text('tokens')}>{period.tokens.toLocaleString(i18n.language)}</td>
                <td data-label={text('status')}>
                  {text(`states.${period.status}`)}
                  {period.error && <small>{period.error}</small>}
                  {period.skipped_cycles > 0 && (
                    <small>
                      {t('usage_notifications.skipped_cycles', { count: period.skipped_cycles })}
                    </small>
                  )}
                </td>
                <td data-label={text('actions')}>
                  {(period.status === 'failed' || period.status === 'unknown') && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => onRetry(period)}
                    >
                      {text('retry')}
                    </Button>
                  )}
                </td>
              </tr>
              <tr className={styles.detailsRow}>
                <td colSpan={6}>
                  <NotificationUsageDetails period={period} />
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
