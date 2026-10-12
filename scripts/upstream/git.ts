/** Git operations shared by patch generation and upstream synchronization. */

/** Run Git without a shell, retaining stdout exactly for source blobs and NUL-delimited paths. */
export function git(repository: string, args: string[], allowFailure = false) {
  const result = Bun.spawnSync(['git', ...args], { cwd: repository });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (!allowFailure && result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
  return { stdout, stderr, exitCode: result.exitCode };
}

/** Read a committed/index blob; a deleted side of a three-way merge is represented by null. */
export function blob(repository: string, ref: string, path: string): string | null {
  const object = `${ref}:${path}`;
  if (git(repository, ['cat-file', '-e', object], true).exitCode !== 0) return null;
  return git(repository, ['show', object]).stdout;
}

/** Read all leaf paths in a tree or directory, including non-JSON assets and symlinks. */
export function treePaths(repository: string, ref: string, directory?: string): string[] {
  const args = ['ls-tree', '-r', '--name-only', '-z', ref];
  if (directory !== undefined) args.push('--', directory);
  return git(repository, args).stdout.split('\0').filter(Boolean);
}
