/** Adopt an exact upstream release and replay the registered plugin extension without publishing. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generatePackageJson } from './upstream/data-files';
import { blob, git } from './upstream/git';
import {
  readUpstreamState,
  restoreForkPaths,
  validateForkChanges,
  validateForkOwnership,
  writeUpstreamState,
} from './upstream/repository';
import {
  generateSourcePatches,
  sourcePatches,
  validateSourcePatches,
} from './upstream/source-patches';

/** Prepare a clean checkout, preserving merge ancestry and rejecting unknown fork edits first. */
export async function syncUpstream(repository: string, upstreamRef: string): Promise<void> {
  if (
    git(repository, ['status', '--porcelain']).stdout.trim() ||
    git(repository, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], true).exitCode === 0
  ) {
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

  // Validate the complete preservation plan before a merge can modify any tracked file.
  validateForkOwnership(repository, baseline);
  validateForkOwnership(repository, upstream);
  validateForkChanges(repository, baseline, Object.keys(sourcePatches), !state.strategy);
  await validateSourcePatches(repository, baseline);
  const candidates = await generateSourcePatches(repository, upstream);
  const packageJson = generatePackageJson(repository, upstream);
  if (blob(repository, upstream, 'bun.lock') === null) {
    throw new Error(`${upstreamRef}: missing upstream bun.lock`);
  }

  // A verified snapshot already contains Bun's resolved plugin graph; do not discard its lockfile.
  if (upstream === baseline && state.strategy === 'upstream-snapshot') {
    console.log(
      `Already prepared ${upstreamRef}: plugin integrations and dependency policy validated`
    );
    return;
  }

  // Retain upstream ancestry, then replace ordinary files with the exact release snapshot.
  const merge = git(repository, ['merge', '--no-ff', '--no-commit', upstream], true);
  const mergeHead = git(
    repository,
    ['rev-parse', '-q', '--verify', 'MERGE_HEAD'],
    true
  ).stdout.trim();
  if (merge.exitCode !== 0 && mergeHead !== upstream) {
    throw new Error(`Upstream merge failed: ${merge.stderr}`);
  }
  git(repository, ['read-tree', '--reset', '-u', upstream]);
  restoreForkPaths(repository, before);

  // Only declared plugin integrations and dependencies modify the upstream-owned snapshot.
  const files = new Map([...candidates, ['package.json', packageJson]]);
  for (const [path, source] of files) {
    mkdirSync(dirname(resolve(repository, path)), { recursive: true });
    writeFileSync(resolve(repository, path), source);
  }
  git(repository, ['add', '--', ...files.keys()]);

  writeUpstreamState(repository, {
    upstreamTag: upstreamRef,
    upstreamCommit: upstream,
    strategy: 'upstream-snapshot',
  });
  console.log(
    `Prepared ${upstreamRef}: adopted upstream snapshot and replayed ${candidates.size} plugin integrations; Bun resolution and verification required before commit`
  );
}

if (import.meta.main) {
  const upstreamRef = process.argv[2];
  if (!upstreamRef) throw new Error('Usage: bun scripts/sync-upstream.ts <upstream-tag>');
  await syncUpstream(process.cwd(), upstreamRef);
}
