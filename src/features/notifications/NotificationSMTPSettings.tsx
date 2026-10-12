// SMTP profile editing keeps the selected draft separate from the active sender.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type {
  UsageNotificationSettings,
  UsageSMTPProfile,
  SMTPPasswordEdits,
  SMTPPasswordEdit,
} from '@/services/api/notifications';
import { newSMTPProfile, removeSMTPProfile } from './smtpProfiles';
import styles from './UsageNotificationsPage.module.scss';

interface NotificationSMTPSettingsProps {
  settings: UsageNotificationSettings;
  onChange: (settings: UsageNotificationSettings) => void;
  passwordEdits: SMTPPasswordEdits;
  onPasswordEditsChange: (edits: SMTPPasswordEdits) => void;
}

/** Edit several senders while selecting exactly one for delivery after saving. */
export function NotificationSMTPSettings({
  settings,
  onChange,
  passwordEdits,
  onPasswordEditsChange,
}: NotificationSMTPSettingsProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`usage_notifications.${key}`);
  const [selectedId, setSelectedId] = useState(settings.active_smtp_profile_id);
  const profile =
    settings.smtp_profiles.find((item) => item.id === selectedId) ??
    settings.smtp_profiles.find((item) => item.id === settings.active_smtp_profile_id) ??
    settings.smtp_profiles[0];
  const activeProfile = settings.smtp_profiles.find(
    (item) => item.id === settings.active_smtp_profile_id
  );
  if (!profile) return null;
  const passwordEdit = passwordEdits[profile.id] ?? { password: '', clear_password: false };

  // All edits target a stable profile ID so changing the editor never transfers credentials.
  const update = <K extends keyof UsageSMTPProfile>(key: K, value: UsageSMTPProfile[K]) =>
    onChange({
      ...settings,
      smtp_profiles: settings.smtp_profiles.map((item) =>
        item.id === profile.id ? { ...item, [key]: value } : item
      ),
    });
  const updatePassword = (edit: Partial<SMTPPasswordEdit>) =>
    onPasswordEditsChange({ ...passwordEdits, [profile.id]: { ...passwordEdit, ...edit } });
  const add = () => {
    const next = newSMTPProfile(text('smtp_new_profile'));
    onChange({ ...settings, smtp_profiles: [...settings.smtp_profiles, next] });
    setSelectedId(next.id);
  };
  const remove = () => {
    onChange(removeSMTPProfile(settings, profile.id));
    const remainingEdits = { ...passwordEdits };
    delete remainingEdits[profile.id];
    onPasswordEditsChange(remainingEdits);
    setSelectedId(settings.active_smtp_profile_id);
  };

  return (
    <Card title={text('smtp')}>
      <div className="form-group">
        <label htmlFor="notification-smtp-profile">{text('smtp_profile')}</label>
        <Select
          id="notification-smtp-profile"
          value={profile.id}
          onChange={setSelectedId}
          options={settings.smtp_profiles.map((item) => ({
            value: item.id,
            label: item.name || item.sender || text('smtp_new_profile'),
          }))}
        />
      </div>
      <div className={styles.profileActions}>
        <Button type="button" variant="secondary" size="sm" onClick={add}>
          {text('smtp_add_profile')}
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={profile.id === settings.active_smtp_profile_id}
          onClick={remove}
        >
          {text('smtp_remove_profile')}
        </Button>
      </div>
      <Input
        label={text('smtp_profile_name')}
        required
        maxLength={100}
        value={profile.name}
        onChange={(e) => update('name', e.target.value)}
      />
      <label className={styles.check}>
        <input
          type="radio"
          name="notification-active-smtp-profile"
          checked={profile.id === settings.active_smtp_profile_id}
          onChange={() => onChange({ ...settings, active_smtp_profile_id: profile.id })}
        />
        {text('smtp_use_profile')}
      </label>
      <p className={styles.muted}>
        {t('usage_notifications.smtp_active_profile', {
          name: activeProfile?.name || activeProfile?.sender || text('smtp_new_profile'),
        })}
      </p>
      <Input
        label={text('smtp_host')}
        required
        value={profile.smtp_host}
        placeholder="smtp.example.com"
        onChange={(e) => update('smtp_host', e.target.value)}
      />
      <Input
        label={text('smtp_port')}
        type="number"
        min={1}
        max={65535}
        step={1}
        required
        value={profile.smtp_port || ''}
        onChange={(e) => update('smtp_port', Number(e.target.value))}
      />
      <div className="form-group">
        <label htmlFor="notification-smtp-security">{text('smtp_security')}</label>
        <Select
          id="notification-smtp-security"
          value={profile.smtp_security}
          onChange={(value) => update('smtp_security', value as 'tls' | 'starttls')}
          options={[
            { value: 'tls', label: text('smtp_tls') },
            { value: 'starttls', label: text('smtp_starttls') },
          ]}
        />
      </div>
      <Input
        label={text('sender')}
        type="email"
        value={profile.sender}
        onChange={(e) => update('sender', e.target.value)}
      />
      <Input
        label={text('smtp_username')}
        autoComplete="username"
        value={profile.smtp_username}
        placeholder={text('smtp_username_hint')}
        onChange={(e) => update('smtp_username', e.target.value)}
      />
      <Input
        label={text('password')}
        type="password"
        autoComplete="new-password"
        value={passwordEdit.password}
        placeholder={text(profile.password_configured ? 'configured' : 'not_configured')}
        onChange={(e) => updatePassword({ password: e.target.value })}
      />
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={passwordEdit.clear_password}
          onChange={(e) => updatePassword({ clear_password: e.target.checked })}
        />
        {text('clear_password')}
      </label>
      <p className={styles.muted}>{text('smtp_profiles_hint')}</p>
      <p className={styles.muted}>{text('smtp_hint')}</p>
      <p className={styles.muted}>{text('security')}</p>
    </Card>
  );
}
