// Verify profile lifecycle without requiring a browser DOM test harness.
import { describe, expect, test } from 'bun:test';
import {
  editableSMTPSettings,
  newSMTPProfile,
  removeSMTPProfile,
} from '../src/features/notifications/smtpProfiles';
import type { UsageNotificationSettings } from '../src/services/api/notifications';

const settings: UsageNotificationSettings = {
  enabled: false,
  frequency: 'weekly',
  weekday: 5,
  hour: 20,
  minute: 0,
  timezone: 'UTC',
  smtp_host: 'smtp.qq.com',
  smtp_port: 465,
  smtp_security: 'tls',
  smtp_username: '',
  sender: '',
  password_configured: false,
  next_at: 0,
  active_smtp_profile_id: '',
  smtp_profiles: [],
};

describe('notification SMTP profiles', () => {
  test('creates an editable profile without sharing saved credentials', () => {
    const draft = editableSMTPSettings(settings, 'Default mailbox');
    expect(draft.active_smtp_profile_id).toBe(draft.smtp_profiles[0].id);
    expect(draft.smtp_profiles[0].name).toBe('Default mailbox');
    expect(draft.smtp_profiles[0].password_configured).toBe(false);
    expect(settings.smtp_profiles).toEqual([]);
    expect(newSMTPProfile('Backup', 'backup').sender).toBe('');
    expect(newSMTPProfile('Backup', 'backup').password_configured).toBe(false);
  });

  test('preserves saved provider settings, profile IDs and active selection', () => {
    const saved = {
      ...settings,
      active_smtp_profile_id: 'backup',
      smtp_profiles: [
        newSMTPProfile('Primary', 'primary'),
        {
          ...newSMTPProfile('Backup', 'backup'),
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_security: 'starttls' as const,
          password_configured: true,
        },
      ],
    };
    expect(editableSMTPSettings(saved, 'Unused')).toBe(saved);
  });

  test('requires another active sender before deleting a profile', () => {
    const saved = {
      ...settings,
      active_smtp_profile_id: 'primary',
      smtp_profiles: [newSMTPProfile('Primary', 'primary'), newSMTPProfile('Backup', 'backup')],
    };
    expect(removeSMTPProfile(saved, 'primary')).toBe(saved);
    const switched = { ...saved, active_smtp_profile_id: 'backup' };
    const removed = removeSMTPProfile(switched, 'primary');
    expect(removed.active_smtp_profile_id).toBe('backup');
    expect(removed.smtp_profiles.map((profile) => profile.id)).toEqual(['backup']);
    expect(saved.smtp_profiles).toHaveLength(2);
  });
});
