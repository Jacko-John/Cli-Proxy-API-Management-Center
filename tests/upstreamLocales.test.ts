import { describe, expect, test } from 'bun:test';
import { completeLocale } from '../scripts/upstream/locales';

describe('locale completion', () => {
  test('fills missing nested keys and preserves translations, extra keys and English input', () => {
    const english = { nav: { title: 'Dashboard', quota: 'Quota' }, new_section: { title: 'New' } };
    const original = structuredClone(english);
    const locale = { nav: { title: 'Bảng điều khiển' }, custom_plural: 'Existing plural form' };
    expect(completeLocale(english, locale)).toEqual(['nav.quota', 'new_section']);
    expect(locale).toEqual({
      nav: { title: 'Bảng điều khiển', quota: 'Quota' },
      new_section: { title: 'New' },
      custom_plural: 'Existing plural form',
    });
    expect(english).toEqual(original);
    expect(completeLocale(english, locale)).toEqual([]);
  });

  test('preserves valid translated interpolation even when tokens change order', () => {
    const english = { message: '{{count}} items for {{name}}' };
    const locale = { message: '{{name}} có {{count}} mục' };
    expect(completeLocale(english, locale)).toEqual([]);
    expect(locale.message).toBe('{{name}} có {{count}} mục');
  });

  test('preserves a native base label when English uses explicit plural variants', () => {
    const english = {
      models_one: '{{count}} model cooling down',
      models_other: '{{count}} models cooling down',
    };
    const locale = { models: '{{count}} 个模型冷却中' };
    expect(completeLocale(english, locale)).toEqual(['models_one', 'models_other']);
    expect(locale).toEqual({
      models: '{{count}} 个模型冷却中',
      models_one: '{{count}} 个模型冷却中',
      models_other: '{{count}} 个模型冷却中',
    });
  });

  test('uses English for mismatched placeholders, blank text and incompatible shapes', () => {
    const english = {
      message: 'Reset after {{count}} minutes',
      title: 'Quota',
      nested: { label: 'Details' },
      list: ['First', 'Second'],
    };
    const locale = { message: 'Reset {{days}}', title: '  ', nested: 'Old shape', list: null };
    expect(completeLocale(english, locale)).toEqual(['message', 'title', 'nested', 'list']);
    expect(locale).toEqual(english);
  });
});
