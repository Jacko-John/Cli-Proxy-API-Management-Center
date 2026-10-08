/** Structural three-way merging for JSON configuration; conflicting values are never guessed. */
import { isDeepStrictEqual } from 'node:util';

export const missing = Symbol('missing JSON value');

/** Objects merge by key; null, arrays and scalar values retain atomic merge semantics. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type ConflictHandler = (path: string, theirs: unknown) => unknown;

/** Merge independent object keys and deletions. Arrays and scalar edits remain atomic. */
export function mergeJson(
  base: unknown,
  ours: unknown,
  theirs: unknown,
  path = '$',
  onConflict?: ConflictHandler
): unknown {
  if (isDeepStrictEqual(ours, theirs) || isDeepStrictEqual(base, theirs)) return ours;
  if (isDeepStrictEqual(base, ours)) return theirs;
  if (isRecord(ours) && isRecord(theirs) && (base === missing || isRecord(base))) {
    const original = isRecord(base) ? base : {};
    const entries: [string, unknown][] = [];
    const keys = new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(original)]);
    for (const key of keys) {
      const value = mergeJson(
        Object.hasOwn(original, key) ? original[key] : missing,
        Object.hasOwn(ours, key) ? ours[key] : missing,
        Object.hasOwn(theirs, key) ? theirs[key] : missing,
        `${path}.${key}`,
        onConflict
      );
      if (value !== missing) entries.push([key, value]);
    }
    return Object.fromEntries(entries);
  }
  if (onConflict) return onConflict(path, theirs);
  throw new Error(`Both upstream and fork changed JSON value ${path}`);
}
