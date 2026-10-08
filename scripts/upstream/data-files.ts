/** Reconcile repository JSON and generated Bun lock data without guessing business conflicts. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { blob, git } from './git';
import { mergeJson, missing } from './json-merge';
import { catalogDirectory } from './locales';
import { isForkOwnedPath } from './repository';

/** Merge generated lock data; conflicting upstream pins still require resolution with Bun. */
export function mergeLockfile(repository: string, baseline: string, upstream: string): string {
  const parse = (ref: string) => {
    const source = blob(repository, ref, 'bun.lock');
    if (source === null) return missing;
    const result = ts.parseConfigFileTextToJson('bun.lock', source);
    if (result.error) throw new Error(`${ref}: malformed Bun lockfile`);
    return result.config;
  };
  const theirs = parse(upstream);
  if (theirs === missing) throw new Error('The upstream release has no Bun lockfile');
  const ours = parse('HEAD');
  const merged = mergeJson(parse(baseline), ours, theirs, '$', (path, value) => {
    console.log(`Generated lockfile conflict ${path}: use upstream pin, then resolve with Bun`);
    return value;
  });

  // Preserve Bun's serialization when the dependency graph is unchanged, including reruns.
  if (isDeepStrictEqual(merged, ours)) return blob(repository, 'HEAD', 'bun.lock')!;
  if (isDeepStrictEqual(merged, theirs)) return blob(repository, upstream, 'bun.lock')!;
  return JSON.stringify(merged, null, 2) + '\n';
}

/** Merge JSON changed by both sides, even when Git's textual merge reports no conflict. */
export function mergeJsonFiles(
  repository: string,
  baseline: string,
  before: string,
  upstream: string
): void {
  const conflicts = new Set(
    git(repository, ['diff', '--name-only', '-z', '--diff-filter=U'])
      .stdout.split('\0')
      .filter(Boolean)
  );
  const changed = (ref: string) =>
    new Set(
      git(repository, ['diff', '--name-only', '-z', baseline, ref, '--', '*.json'])
        .stdout.split('\0')
        .filter(Boolean)
    );
  const ours = changed(before);
  const theirs = changed(upstream);
  const paths = new Set([...conflicts, ...[...ours].filter((path) => theirs.has(path))]);

  // Language catalogs and fork-owned files have their own replacement policies.
  for (const path of paths) {
    if (
      !path.endsWith('.json') ||
      path.startsWith(`${catalogDirectory}/`) ||
      isForkOwnedPath(path)
    ) {
      continue;
    }
    const parse = (ref: string) => {
      const source = blob(repository, ref, path);
      return source === null ? missing : JSON.parse(source);
    };

    // Index stages preserve Git's rename detection for conflicted paths.
    const refs = conflicts.has(path) ? [':1', ':2', ':3'] : [baseline, before, upstream];
    const value = mergeJson(parse(refs[0]), parse(refs[1]), parse(refs[2]), path);
    if (value === missing) {
      git(repository, ['rm', '-f', '--ignore-unmatch', '--', path]);
    } else {
      writeFileSync(resolve(repository, path), JSON.stringify(value, null, 2) + '\n');
      git(repository, ['add', '--', path]);
    }
  }
}
