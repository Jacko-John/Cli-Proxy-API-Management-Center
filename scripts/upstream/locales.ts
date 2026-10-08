/** Read, normalize and validate upstream catalogs without mixing in fork translations. */
import { isDeepStrictEqual } from 'node:util';
import { blob, treePaths } from './git';
import { isRecord } from './json-merge';

type Locale = Record<string, unknown>;

export const catalogDirectory = 'src/i18n/locales';

/** Compare interpolation token multisets, allowing translated sentences to reorder them. */
const interpolationTokens = (value: unknown): string =>
  (String(value ?? '').match(/\{\{[^}]+\}\}/g) ?? []).sort().join('|');

/** Preserve native unsuffixed plural labels before falling back to the English reference. */
function fallbackTranslation(english: Locale, locale: Locale, key: string, reference: unknown) {
  const baseKey = key.replace(/_(zero|one|two|few|many|other)$/, '');
  const localBase = locale[baseKey];
  if (
    baseKey !== key &&
    Object.hasOwn(english, `${baseKey}_one`) &&
    Object.hasOwn(english, `${baseKey}_other`) &&
    typeof reference === 'string' &&
    typeof localBase === 'string' &&
    localBase.trim() !== '' &&
    interpolationTokens(reference) === interpolationTokens(localBase)
  ) {
    return localBase;
  }
  return structuredClone(reference);
}

/** Fill missing/invalid leaves in place; return changed keys and leave valid translations intact. */
export function completeLocale(english: Locale, locale: Locale, prefix = ''): string[] {
  const fallbackKeys: string[] = [];
  for (const [key, reference] of Object.entries(english)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const translation = locale[key];
    if (isRecord(reference) && isRecord(translation)) {
      fallbackKeys.push(...completeLocale(reference, translation, path));
      continue;
    }
    const incompatible =
      typeof reference !== typeof translation ||
      isRecord(reference) !== isRecord(translation) ||
      Array.isArray(reference) !== Array.isArray(translation) ||
      (reference === null && translation !== null);
    const emptyTranslation =
      typeof reference === 'string' &&
      reference.trim() !== '' &&
      typeof translation === 'string' &&
      translation.trim() === '';
    if (
      !Object.hasOwn(locale, key) ||
      incompatible ||
      emptyTranslation ||
      interpolationTokens(reference) !== interpolationTokens(translation)
    ) {
      locale[key] = fallbackTranslation(english, locale, key, reference);
      fallbackKeys.push(path);
    }
  }
  return fallbackKeys;
}

/** Require object catalogs rather than silently replacing malformed release data. */
export function readLocale(path: string, source: string): Locale {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) throw new Error(`${path} must contain a translation object`);
  return value;
}

/** Read one immutable release and recompute missing translation fallbacks from its English. */
export function readUpstreamCatalogs(repository: string, ref: string): Map<string, string> {
  const sources = new Map(
    treePaths(repository, ref, catalogDirectory).map((path) => [path, blob(repository, ref, path)!])
  );
  const englishPath = `${catalogDirectory}/en.json`;
  const reference = sources.get(englishPath);
  if (!reference) throw new Error(`${ref}: upstream English catalog is missing`);
  const english = readLocale(englishPath, reference);

  // Retain valid native translations and non-JSON assets exactly as supplied by upstream.
  for (const [path, source] of sources) {
    if (!path.endsWith('.json') || path === englishPath) continue;
    const locale = readLocale(path, source);
    if (completeLocale(english, locale).length > 0) {
      sources.set(path, JSON.stringify(locale, null, 2) + '\n');
    }
  }
  return sources;
}

/** Refuse to replace custom catalog edits that belong in the separate fork translation layer. */
export function validateUpstreamCatalogs(repository: string, baseline: string): void {
  const expectedCatalogs = readUpstreamCatalogs(repository, baseline);
  const ours = treePaths(repository, 'HEAD', catalogDirectory);
  if (!isDeepStrictEqual([...expectedCatalogs.keys()].sort(), ours.sort())) {
    throw new Error(
      'Fork catalog paths differ from upstream; move custom catalogs into the fork layer'
    );
  }

  // Accept both the raw bootstrap catalogs and normalized catalogs from earlier synchronizations.
  for (const [path, expected] of expectedCatalogs) {
    const current = blob(repository, 'HEAD', path)!;
    const original = blob(repository, baseline, path)!;
    const equal = path.endsWith('.json')
      ? [expected, original].some((value) =>
          isDeepStrictEqual(JSON.parse(value), JSON.parse(current))
        )
      : current === original;
    if (!equal) throw new Error(`${path}: fork edits to upstream-owned catalogs would be lost`);
  }
}
