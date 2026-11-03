import { describe, expect, test } from 'bun:test';
import { createInstance } from 'i18next';
import i18n from '../src/i18n/index';
import { forkTranslations, registerForkTranslations } from '../src/i18n/forkTranslations';

describe('fork translation registration', () => {
  for (const [language, translations] of Object.entries(forkTranslations)) {
    test(`preserves upstream text and adds missing nested plugin keys for ${language}`, async () => {
      const base = {
        nav: { dashboard: 'Upstream dashboard', monitoring_center: 'Upstream monitoring' },
        common: { cancel: 'Upstream cancel' },
      };
      const original = structuredClone(base);
      const instance = createInstance();
      await instance.init({
        resources: { [language]: { translation: base } },
        lng: language,
        fallbackLng: 'zh-CN',
      });

      registerForkTranslations(instance);

      expect(instance.t('nav.dashboard')).toBe('Upstream dashboard');
      expect(instance.t('common.cancel')).toBe('Upstream cancel');
      expect(instance.t('nav.monitoring_center')).toBe('Upstream monitoring');
      expect(instance.t('nav.usage_notifications')).toBe(translations.nav.usage_notifications);
      expect(instance.t('usage_notifications.title')).toBe(translations.usage_notifications.title);
      expect(base).toEqual(original);

      const registered = structuredClone(instance.getResourceBundle(language, 'translation'));
      registerForkTranslations(instance);
      expect(instance.getResourceBundle(language, 'translation')).toEqual(registered);
    });

    test(`has fork text available immediately after app initialization for ${language}`, () => {
      expect(i18n.t('nav.usage_notifications', { lng: language })).toBe(
        translations.nav.usage_notifications
      );
    });
  }

  test('preserves existing empty values and incompatible upstream resource shapes', async () => {
    const base = {
      nav: 'Upstream navigation schema',
      nav_meta: { monitoring_center: '', credential_center: null, safety_center: undefined },
      codex_quota: ['Upstream quota labels'],
      usage_stats: null,
    };
    const original = structuredClone(base);
    const instance = createInstance();
    await instance.init({ resources: { en: { translation: base } }, lng: 'en' });

    registerForkTranslations(instance);

    const registered = instance.getResourceBundle('en', 'translation');
    expect(registered.nav).toBe(base.nav);
    expect(registered.nav_meta).toEqual(base.nav_meta);
    expect(registered.codex_quota).toEqual(base.codex_quota);
    expect(registered.usage_stats).toBeNull();
    expect(registered.usage_notifications).toEqual(forkTranslations.en.usage_notifications);
    expect(base).toEqual(original);
  });

  test('keeps an additional upstream language and uses existing fallback for fork keys', async () => {
    const instance = createInstance();
    await instance.init({
      resources: {
        vi: { translation: { nav: { dashboard: 'Bảng điều khiển' } } },
      },
      lng: 'vi',
      fallbackLng: 'zh-CN',
    });

    registerForkTranslations(instance);

    expect(instance.t('nav.dashboard')).toBe('Bảng điều khiển');
    expect(instance.t('nav.usage_notifications')).toBe(
      forkTranslations['zh-CN'].nav.usage_notifications
    );
    expect(instance.getResourceBundle('vi', 'translation')).toEqual({
      nav: { dashboard: 'Bảng điều khiển' },
    });
  });
});
