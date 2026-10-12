import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { NotificationSMTPSettings } from '../src/features/notifications/NotificationSMTPSettings';
import { notificationTranslations } from '../src/i18n/notificationTranslations';
import type { UsageNotificationSettings } from '../src/services/api/notifications';

const settings: UsageNotificationSettings = {
  enabled: true,
  frequency: 'weekly',
  weekday: 1,
  hour: 9,
  minute: 30,
  timezone: 'UTC',
  smtp_host: 'smtp.example.com',
  smtp_port: 587,
  smtp_security: 'starttls',
  smtp_username: 'smtp-account',
  sender: 'reports@example.com',
  password_configured: true,
  next_at: 0,
  active_smtp_profile_id: 'primary',
  smtp_profiles: [
    {
      id: 'primary',
      name: 'Primary mailbox',
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_security: 'starttls',
      smtp_username: 'smtp-account',
      sender: 'reports@example.com',
      password_configured: true,
    },
  ],
};

async function renderSMTP(locale: string, value = settings) {
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    resources: Object.fromEntries(
      Object.entries(notificationTranslations).map(([language, usage_notifications]) => [
        language,
        { translation: { usage_notifications } },
      ])
    ),
  });
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(NotificationSMTPSettings, {
        settings: value,
        onChange: () => {},
        passwordEdits: {},
        onPasswordEditsChange: () => {},
      })
    )
  );
}

describe('notification SMTP configuration', () => {
  test('renders the provider configuration and separate login account', async () => {
    const markup = await renderSMTP('en');
    for (const value of [
      'smtp.example.com',
      '587',
      'STARTTLS',
      'smtp-account',
      'reports@example.com',
    ]) {
      expect(markup).toContain(value);
    }
    expect(markup).toContain('min="1"');
    expect(markup).toContain('max="65535"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('Configured; leave blank to keep');
    expect(markup).not.toContain('QQ');
  });

  test('renders implicit TLS and distinguishes an unconfigured password', async () => {
    const markup = await renderSMTP('en', {
      ...settings,
      smtp_profiles: [
        {
          ...settings.smtp_profiles[0],
          smtp_security: 'tls',
          smtp_port: 465,
          smtp_username: '',
          password_configured: false,
        },
      ],
    });
    expect(markup).toContain('Implicit TLS');
    expect(markup).toContain('465');
    expect(markup).toContain('Leave blank to use the sender address');
    expect(markup).toContain('Not configured');
  });

  test('localizes SMTP fields and guidance in all four languages', async () => {
    for (const [locale, labels] of Object.entries(notificationTranslations)) {
      const markup = await renderSMTP(locale);
      for (const value of [
        labels.smtp,
        labels.smtp_host,
        labels.smtp_port,
        labels.smtp_security,
        labels.smtp_username,
        labels.sender,
        labels.password,
        labels.smtp_hint,
        labels.smtp_profile,
        labels.smtp_profile_name,
        labels.smtp_add_profile,
        labels.smtp_remove_profile,
        labels.smtp_use_profile,
        labels.smtp_profiles_hint,
      ]) {
        expect(markup).toContain(value);
      }
      expect(markup).not.toContain('usage_notifications.');
    }
  });

  test('edits the active profile and protects it from deletion', async () => {
    const markup = await renderSMTP('en', {
      ...settings,
      active_smtp_profile_id: 'backup',
      smtp_profiles: [
        settings.smtp_profiles[0],
        {
          ...settings.smtp_profiles[0],
          id: 'backup',
          name: 'Backup mailbox',
          smtp_host: 'backup.example.com',
          sender: 'backup@example.com',
          password_configured: false,
        },
      ],
    });
    expect(markup).toContain('backup.example.com');
    expect(markup).not.toContain('value="smtp.example.com"');
    expect(markup).toContain('Sender profile: Backup mailbox');
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('checked=""');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Not configured');
  });
});
