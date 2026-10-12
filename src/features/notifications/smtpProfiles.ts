// Profile edits preserve each sender's independent settings and unsaved password changes.
import type { UsageNotificationSettings, UsageSMTPProfile } from '@/services/api/notifications';
import { generateId } from '@/utils/helpers';

/** Create a sender draft with the same TLS defaults as the plugin. */
export function newSMTPProfile(name: string, id = generateId()): UsageSMTPProfile {
  return {
    id,
    name,
    smtp_host: 'smtp.qq.com',
    smtp_port: 465,
    smtp_security: 'tls',
    smtp_username: '',
    sender: '',
    password_configured: false,
  };
}

/** Give a new installation one editable profile; keep saved profiles and their active ID intact. */
export function editableSMTPSettings(
  settings: UsageNotificationSettings,
  defaultName: string
): UsageNotificationSettings {
  if (settings.smtp_profiles?.length) return settings;
  const profile = {
    ...newSMTPProfile(defaultName),
    smtp_host: settings.smtp_host,
    smtp_port: settings.smtp_port,
    smtp_security: settings.smtp_security,
    smtp_username: settings.smtp_username,
    sender: settings.sender,
    password_configured: settings.password_configured,
  };
  return { ...settings, smtp_profiles: [profile], active_smtp_profile_id: profile.id };
}

/** Remove a draft only after another profile has been chosen for delivery. */
export function removeSMTPProfile(
  settings: UsageNotificationSettings,
  id: string
): UsageNotificationSettings {
  if (id === settings.active_smtp_profile_id) return settings;
  return {
    ...settings,
    smtp_profiles: settings.smtp_profiles.filter((profile) => profile.id !== id),
  };
}
