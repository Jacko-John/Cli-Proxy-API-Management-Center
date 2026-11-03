/** Verify release artifact identity, local Git transfer and real approval checks through isolated APIs. */
import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CandidateManifest } from '../../scripts/upstream/release-candidate';

const helper = fileURLToPath(
  new URL('../../scripts/upstream/release-candidate.ts', import.meta.url)
);
const directories: string[] = [];
const environmentId = 26127886967;
const reviewerId = 161927015;

// Every temporary bare repository and fake API belongs to one test, including failed preparations.
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Write fixture files without relying on production serialization or globally changing environment. */
function write(directory: string, path: string, content: string | object): void {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content) + '\n');
}

/** Run real Git commands against only a test-owned local repository. */
function git(directory: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: directory });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

/** Commit an explicit fixture revision with no dependency on machine signing or user configuration. */
function commit(directory: string, message: string): string {
  git(directory, 'add', '.');
  git(directory, 'commit', '--allow-empty', '-qm', message);
  return git(directory, 'rev-parse', 'HEAD');
}

/** Prepare independent source and publishing checkouts plus a strict, offline GitHub API executable. */
function fixture(unchangedSource = false) {
  const root = mkdtempSync(join(tmpdir(), 'release-candidate-'));
  directories.push(root);
  const origin = join(root, 'origin.git');
  const prepare = join(root, 'prepare');
  const publish = join(root, 'publish');
  const candidate = join(root, 'candidate');
  const api = join(root, 'api');
  const bin = join(root, 'bin');
  git(root, 'init', '--bare', '--initial-branch=main', origin);
  git(root, 'init', '--initial-branch=main', prepare);
  git(prepare, 'config', 'user.name', 'Release fixture');
  git(prepare, 'config', 'user.email', 'fixture@example.invalid');
  git(prepare, 'config', 'commit.gpgsign', 'false');
  git(prepare, 'config', 'core.hooksPath', '/dev/null');
  const upstream = commit(prepare, 'Upstream release');
  git(prepare, 'tag', 'v1.0.0');
  write(prepare, '.github/upstream-sync.json', {
    upstreamTag: 'v1.0.0',
    upstreamCommit: upstream,
  });
  const base = commit(prepare, 'Existing main');
  git(prepare, 'remote', 'add', 'origin', origin);
  git(prepare, 'push', '-q', 'origin', 'main');
  let source = base;
  if (!unchangedSource) {
    write(prepare, '.github/upstream-sync.json', {
      upstreamTag: 'v1.0.0',
      upstreamCommit: upstream,
      strategy: 'upstream-snapshot',
    });
    source = commit(prepare, 'Prepared plugin overlay');
  }
  write(prepare, 'dist/index.html', '<!doctype html><title>Candidate fixture</title>\n');
  git(root, 'clone', '-q', origin, publish);

  write(api, 'environment.json', {
    id: environmentId,
    name: 'manual-release-override',
    can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    protection_rules: [
      {
        type: 'required_reviewers',
        prevent_self_review: false,
        reviewers: [{ type: 'User', reviewer: { id: reviewerId } }],
      },
    ],
  });
  write(api, 'policies.json', {
    total_count: 1,
    branch_policies: [{ name: 'main', type: 'branch' }],
  });
  write(api, 'approvals.json', []);
  write(
    bin,
    'gh',
    `#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const endpoint = process.argv.find((value) => value.startsWith('repos/'));
const filename = endpoint?.includes('/deployment-branch-policies') ? 'policies.json'
  : endpoint?.endsWith('/approvals') ? 'approvals.json'
  : endpoint?.endsWith('/environments/manual-release-override') ? 'environment.json' : null;
if (!filename || process.argv.slice(2, 5).join(' ') !== 'api --method GET') process.exit(77);
process.stdout.write(readFileSync(join(process.env.GH_FIXTURE_DIR, filename), 'utf8'));
`
  );
  chmodSync(join(bin, 'gh'), 0o755);

  const environment: Record<string, string> = {
    GITHUB_REPOSITORY: 'Jacko-John/Cli-Proxy-API-Management-Center',
    GITHUB_RUN_ID: '123456',
    GITHUB_RUN_ATTEMPT: '1',
    BASE_COMMIT: base,
    SOURCE_COMMIT: source,
    UPSTREAM_TAG: 'v1.0.0',
    UPSTREAM_COMMIT: upstream,
    UPSTREAM_URL:
      'https://github.com/router-for-me/Cli-Proxy-API-Management-Center/releases/tag/v1.0.0',
    PATCH_TAG: 'v1.0.0-patch.1',
    TEST_OUTCOME: 'success',
    LINT_OUTCOME: 'success',
    BUILD_OUTCOME: 'success',
    ALLOW_VALIDATION_OVERRIDE: 'false',
    CANDIDATE_DIR: candidate,
    GH_FIXTURE_DIR: api,
    PATH: `${bin}:${process.env.PATH}`,
  };

  return { root, prepare, publish, candidate, api, base, source, environment };
}

/** Execute the actual CLI with fake GitHub available only inside this subprocess and its children. */
function run(
  value: ReturnType<typeof fixture>,
  operation: 'pack' | 'verify' | 'approval',
  overrides: Record<string, string> = {}
) {
  const result = Bun.spawnSync([process.execPath, helper, operation], {
    cwd: operation === 'pack' ? value.prepare : value.publish,
    env: { ...process.env, ...value.environment, GITHUB_OUTPUT: undefined, ...overrides },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/** Include command diagnostics when a positive integration assertion fails. */
function succeeds(result: ReturnType<typeof run>): void {
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  expect(result.exitCode).toBe(0);
}

/** Inspect the independently serialized artifact for public release and policy assertions. */
function manifest(value: ReturnType<typeof fixture>): CandidateManifest {
  return JSON.parse(readFileSync(join(value.candidate, 'manifest.json'), 'utf8'));
}

describe('prepared release candidates', () => {
  test('packs committed source, preserves logs and imports exactly that source in another checkout', () => {
    const value = fixture();
    write(value.candidate, 'test.log', 'Retained validation output\n');
    const outputs = join(value.root, 'outputs');
    succeeds(run(value, 'pack', { GITHUB_OUTPUT: outputs }));
    expect(manifest(value).requiresApproval).toBe(false);
    expect(existsSync(join(value.candidate, 'candidate.bundle'))).toBe(true);
    expect(readFileSync(join(value.candidate, 'test.log'), 'utf8')).toBe(
      'Retained validation output\n'
    );
    expect(readFileSync(outputs, 'utf8')).toBe(
      `requires_approval=false\nsource_commit=${value.source}\n`
    );
    succeeds(run(value, 'verify'));
    expect(git(value.publish, 'rev-parse', 'refs/remotes/candidate/release')).toBe(value.source);
    expect(git(value.publish, 'rev-parse', 'HEAD')).toBe(value.base);
    expect(readFileSync(join(value.candidate, 'release-notes.md'), 'utf8')).not.toContain(
      'manual approval'
    );
  });

  test('an unchanged source verifies successfully without a bundle', () => {
    const value = fixture(true);
    succeeds(run(value, 'pack'));
    expect(manifest(value).bundleSha256).toBeNull();
    expect(existsSync(join(value.candidate, 'candidate.bundle'))).toBe(false);
    succeeds(run(value, 'verify'));
  });

  test('failed checks require both explicit override permission and the matching actual owner review', () => {
    const value = fixture();
    const outcomes = { TEST_OUTCOME: 'failure', ALLOW_VALIDATION_OVERRIDE: 'true' };
    expect(run(value, 'pack', { TEST_OUTCOME: 'failure' }).stderr).toContain(
      'does not allow an approval override'
    );
    expect(existsSync(join(value.candidate, 'manifest.json'))).toBe(false);
    succeeds(run(value, 'pack', outcomes));
    expect(manifest(value).approvalEnvironmentId).toBe(environmentId);
    expect(run(value, 'approval', outcomes).stderr).toContain('no matching human approval');
    write(value.api, 'approvals.json', [
      { state: 'approved', user: { id: reviewerId + 1 }, environments: [{ id: environmentId }] },
    ]);
    expect(run(value, 'approval', outcomes).stderr).toContain('no matching human approval');
    write(value.api, 'approvals.json', [
      { state: 'approved', user: { id: reviewerId }, environments: [{ id: environmentId }] },
    ]);
    const missingSource = Bun.spawnSync(['git', 'cat-file', '-e', value.source], {
      cwd: value.publish,
    });
    expect(missingSource.exitCode).not.toBe(0);
    succeeds(run(value, 'approval', outcomes));
    expect(readFileSync(join(value.candidate, 'review.md'), 'utf8')).toContain(
      'Manual approval is required before publishing'
    );
    expect(readFileSync(join(value.candidate, 'review.md'), 'utf8')).not.toContain(
      'Published after manual approval'
    );
    expect(readFileSync(join(value.candidate, 'release-notes.md'), 'utf8')).toContain(
      'Published after manual approval of failed validation checks.'
    );
    succeeds(run(value, 'verify', outcomes));
  });

  test('a failed check override on a rerun is refused while a clean rerun remains valid', () => {
    const value = fixture();
    expect(
      run(value, 'pack', {
        TEST_OUTCOME: 'failure',
        ALLOW_VALIDATION_OVERRIDE: 'true',
        GITHUB_RUN_ATTEMPT: '2',
      }).stderr
    ).toContain('reruns cannot reuse approval');
    succeeds(run(value, 'pack', { GITHUB_RUN_ATTEMPT: '2' }));
    succeeds(run(value, 'verify', { GITHUB_RUN_ATTEMPT: '2' }));
  });

  test('a modified HTML asset is rejected before source import', () => {
    const value = fixture();
    succeeds(run(value, 'pack'));
    write(value.candidate, 'management.html', 'Modified artifact');
    expect(run(value, 'verify').stderr).toContain('HTML checksum does not match');
  });

  test('an artifact from an earlier run attempt is rejected', () => {
    const value = fixture();
    succeeds(run(value, 'pack'));
    expect(run(value, 'verify', { GITHUB_RUN_ATTEMPT: '2' }).stderr).toContain(
      'runAttempt does not match'
    );
  });

  test('a new origin main commit invalidates a candidate without pushing anything', () => {
    const value = fixture();
    succeeds(run(value, 'pack'));
    const moved = commit(value.prepare, 'New main update');
    git(value.prepare, 'push', '-q', 'origin', 'main');
    expect(run(value, 'verify').stderr).toContain('Origin main moved after candidate preparation');
    expect(git(value.publish, 'rev-parse', 'HEAD')).toBe(value.base);
    expect(git(value.publish, 'rev-parse', 'refs/remotes/origin/main')).toBe(moved);
  });

  test('replaced approval environments and wider branch rules are refused', () => {
    const value = fixture();
    const outcomes = { TEST_OUTCOME: 'failure', ALLOW_VALIDATION_OVERRIDE: 'true' };
    succeeds(run(value, 'pack', outcomes));
    const file = join(value.api, 'environment.json');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    write(value.api, 'environment.json', { ...data, id: environmentId + 1 });
    expect(run(value, 'approval', outcomes).stderr).toContain('Approval environment was replaced');
    write(value.api, 'environment.json', data);
    write(value.api, 'policies.json', {
      total_count: 1,
      branch_policies: [{ name: '*', type: 'branch' }],
    });
    expect(run(value, 'approval', outcomes).stderr).toContain('permit only the main branch');
  });
});
