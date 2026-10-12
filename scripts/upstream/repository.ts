/** Recorded upstream state and ownership rules for restoring fork-maintained paths. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, treePaths } from './git';

const statePath = '.github/upstream-sync.json';

// Extension namespaces belong exclusively to the fork, unlike intentionally overridden metadata.
const forkExtensionPaths = [
  'src/fork',
  'src/features/notifications',
  'src/i18n/forkTranslations.ts',
  'src/i18n/notificationTranslations.ts',
  'src/services/api/notifications.ts',
  'src/services/api/usagePluginClient.ts',
];

const forkOwnedPaths = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  statePath,
  '.github/workflows/sync-upstream.yml',
  'scripts/upstream',
  'scripts/sync-upstream.ts',
  'scripts/apply-fork-patches.ts',
  ...forkExtensionPaths,
];

interface UpstreamState {
  upstreamTag: string;
  upstreamCommit: string;
}

/** Read the shared baseline used by synchronization and development patch generation. */
export function readUpstreamState(repository: string): UpstreamState {
  return JSON.parse(readFileSync(resolve(repository, statePath), 'utf8'));
}

/** Record and stage the new baseline only after source preparation succeeds. */
export function writeUpstreamState(repository: string, state: UpstreamState): void {
  writeFileSync(resolve(repository, statePath), JSON.stringify(state, null, 2) + '\n');
  git(repository, ['add', '--', statePath]);
}

/** Keep file and directory ownership checks consistent with fork restoration. */
export function isForkOwnedPath(path: string): boolean {
  return forkOwnedPaths.some((owned) => path === owned || path.startsWith(`${owned}/`));
}

/** Reject extension namespace collisions, including files that obstruct a reserved parent path. */
export function validateForkOwnership(repository: string, upstream: string): void {
  // Inspect tree entries rather than diffs: identical additions and new child files can merge cleanly.
  const collisions = treePaths(repository, upstream).filter((path) =>
    forkExtensionPaths.some(
      (owned) => path === owned || path.startsWith(`${owned}/`) || owned.startsWith(`${path}/`)
    )
  );
  if (collisions.length) {
    throw new Error(
      `${upstream}: upstream occupies fork extension paths; resolve ownership before synchronization:\n${collisions.join('\n')}`
    );
  }
}

/** Restore fork-owned content, including the absence of paths newly introduced by upstream. */
export function restoreForkPaths(repository: string, before: string): void {
  for (const path of forkOwnedPaths) {
    const expected = new Set(treePaths(repository, before, path));
    const current = git(repository, ['ls-files', '-z', '--', path])
      .stdout.split('\0')
      .filter(Boolean);
    const remove = [...new Set(current)].filter((file) => !expected.has(file));
    if (remove.length) git(repository, ['rm', '-f', '--', ...remove]);
    if (expected.size) {
      git(repository, ['restore', `--source=${before}`, '--staged', '--worktree', '--', path]);
    }
  }
}
