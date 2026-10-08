/** Prepare an upstream merge; dependency resolution, verification and publication belong to CI. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { git } from './upstream/git';
import { mergeJsonFiles, mergeLockfile } from './upstream/data-files';
import {
  catalogDirectory,
  readUpstreamCatalogs,
  validateUpstreamCatalogs,
} from './upstream/locales';
import { readUpstreamState, restoreForkPaths, writeUpstreamState } from './upstream/repository';
import { generateSourcePatches, validateSourcePatches } from './upstream/source-patches';

/** Prepare a clean checkout without committing; preserve unresolved business conflicts for review. */
export async function syncUpstream(repository: string, upstreamRef: string): Promise<void> {
  // Require a clean fork and a release descended from its exact recorded upstream baseline.
  if (git(repository, ['status', '--porcelain']).stdout.trim()) {
    throw new Error('Upstream synchronization requires a clean checkout');
  }
  const before = git(repository, ['rev-parse', 'HEAD']).stdout.trim();
  const upstream = git(repository, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${upstreamRef}^{commit}`,
  ]).stdout.trim();
  const state = readUpstreamState(repository);
  const baseline = state.upstreamCommit;
  for (const target of [before, upstream]) {
    if (git(repository, ['merge-base', '--is-ancestor', baseline, target], true).exitCode !== 0) {
      throw new Error(
        `Release ${upstreamRef} is not a descendant of the recorded baseline ${state.upstreamTag}`
      );
    }
  }

  // Validate ownership and build all generated content before mutating the checkout.
  await validateSourcePatches(repository, baseline);
  validateUpstreamCatalogs(repository, baseline);
  const candidates = await generateSourcePatches(repository, upstream);
  const upstreamCatalogs = readUpstreamCatalogs(repository, upstream);
  const lockfile = mergeLockfile(repository, baseline, upstream);

  // Let Git merge ordinary code, then restore the paths explicitly maintained by the fork.
  const merge = git(repository, ['merge', '--no-ff', '--no-commit', upstream], true);
  const mergeHead = git(
    repository,
    ['rev-parse', '-q', '--verify', 'MERGE_HEAD'],
    true
  ).stdout.trim();
  if (merge.exitCode !== 0 && mergeHead !== upstream) {
    throw new Error(`Upstream merge failed: ${merge.stderr}`);
  }
  restoreForkPaths(repository, before);

  // Replace managed sources and catalogs, including languages removed by upstream.
  const catalogPaths = git(repository, ['ls-files', '-z', '--', catalogDirectory])
    .stdout.split('\0')
    .filter(Boolean);
  const deleted = [...new Set(catalogPaths)].filter((path) => !upstreamCatalogs.has(path));
  if (deleted.length) git(repository, ['rm', '-f', '--', ...deleted]);
  const files = new Map([...candidates, ...upstreamCatalogs, ['bun.lock', lockfile]]);
  for (const [path, source] of files) {
    mkdirSync(dirname(resolve(repository, path)), { recursive: true });
    writeFileSync(resolve(repository, path), source);
  }
  git(repository, ['add', '--', ...files.keys()]);

  // Reconcile configuration by value and refuse to hide remaining business conflicts.
  mergeJsonFiles(repository, baseline, before, upstream);
  const conflicts = git(repository, ['diff', '--name-only', '--diff-filter=U']).stdout.trim();
  if (conflicts) {
    throw new Error(
      `Unresolved upstream conflicts outside the registered patch layer:\n${conflicts}`
    );
  }

  // Record the prepared baseline; CI must resolve dependencies and verify before committing.
  writeUpstreamState(repository, { upstreamTag: upstreamRef, upstreamCommit: upstream });
  console.log(
    `Prepared ${upstreamRef}: replayed ${candidates.size} source integrations; Bun resolution and verification required before commit`
  );
}

if (import.meta.main) {
  const upstreamRef = process.argv[2];
  if (!upstreamRef) throw new Error('Usage: bun scripts/sync-upstream.ts <upstream-tag>');
  await syncUpstream(process.cwd(), upstreamRef);
}
