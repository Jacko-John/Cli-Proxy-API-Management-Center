import { useTranslation } from 'react-i18next';
import type { UsageNotificationPeriod } from '@/services/api/notifications';
import { notificationCost } from './logic';
import styles from './NotificationUsageDetails.module.scss';

interface NotificationUsageDetailsProps {
  period: UsageNotificationPeriod;
}

export function NotificationUsageDetails({ period }: NotificationUsageDetailsProps) {
  const { t, i18n } = useTranslation();
  const text = (key: string) => t(`usage_notifications.${key}`);
  const details = period.details;

  return (
    <details className={styles.details} open={period.status === 'open'}>
      <summary>
        {text('details')}
        {details && (
          <span className={styles.count}>
            {t('usage_notifications.detail_groups', { count: details.length })}
          </span>
        )}
      </summary>
      {!details ? (
        <p className={styles.muted}>{text('details_unavailable')}</p>
      ) : !details.length ? (
        <p className={styles.muted}>{text('details_empty')}</p>
      ) : (
        <table className={styles.table} aria-label={text('details')}>
          <thead>
            <tr>
              {['model', 'service_tier', 'requests', 'tokens', 'cost'].map((key) => (
                <th key={key} scope="col">
                  {text(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {details.map((detail) => (
              <tr key={JSON.stringify([detail.model, detail.service_tier])}>
                <td data-label={text('model')} className={styles.model}>
                  {detail.model}
                </td>
                <td data-label={text('service_tier')}>
                  {detail.service_tier || text('tier_unreported')}
                </td>
                <td data-label={text('requests')}>
                  {detail.requests.toLocaleString(i18n.language)}
                </td>
                <td data-label={text('tokens')}>{detail.tokens.toLocaleString(i18n.language)}</td>
                <td data-label={text('cost')}>
                  {notificationCost(detail, 6)}
                  {detail.unpriced_requests > 0 && (
                    <small>
                      {t('usage_notifications.unpriced', { count: detail.unpriced_requests })}
                    </small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
