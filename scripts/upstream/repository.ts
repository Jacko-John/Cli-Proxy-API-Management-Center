/** Recorded upstream state and ownership rules for restoring fork-maintained paths. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, treePaths } from './git';

const statePath = '.github/upstream-sync.json';
const forkOwnedPaths = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  statePath,
  '.github/workflows/sync-upstream.yml',
  'scripts/upstream',
  'scripts/sync-upstream.ts',
  'scripts/apply-fork-patches.ts',
  'src/fork',
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
