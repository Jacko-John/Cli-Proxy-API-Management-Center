/** Bind a prepared release artifact to its source, workflow attempt and any required human review. */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import {
  hasApprovedReview,
  validateApprovalEnvironment,
  validationNeedsApproval,
  type CheckOutcome,
} from './release-policy';

const approvalEnvironment = 'manual-release-override';
const reviewerId = 161927015;
type Environment = Record<string, string | undefined>;

export interface CandidateManifest {
  schema: 1;
  repository: string;
  runId: string;
  runAttempt: string;
  baseCommit: string;
  sourceCommit: string;
  sourceTree: string;
  upstreamTag: string;
  upstreamCommit: string;
  upstreamUrl: string;
  patchTag: string;
  testOutcome: CheckOutcome;
  lintOutcome: CheckOutcome;
  buildOutcome: CheckOutcome;
  requiresApproval: boolean;
  approvalEnvironmentId: number | null;
  htmlSha256: string;
  bundleSha256: string | null;
}

/** Run a local command without shell interpolation and keep routine command output out of the log. */
function command(repository: string, executable: string, args: string[]): string {
  const result = Bun.spawnSync([executable, ...args], { cwd: repository });
  if (result.exitCode !== 0) {
    throw new Error(`${executable} ${args[0] ?? ''} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

/** Require explicit workflow inputs rather than manufacturing release identity defaults. */
function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (!value || value.includes('\n') || value.includes('\r')) {
    throw new Error(`Missing or invalid ${name}`);
  }
  return value;
}

/** Parse GitHub JSON through the existing CLI authentication, using read-only API requests only. */
function github(repository: string, endpoint: string): unknown {
  return JSON.parse(command(repository, 'gh', ['api', '--method', 'GET', endpoint]));
}

/** Narrow parsed artifact and API records at their trust boundaries. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accept only the complete versioned manifest and completed, policy-consistent validation checks. */
export function parseCandidateManifest(value: unknown): CandidateManifest {
  if (!isRecord(value) || value.schema !== 1) throw new Error('Unsupported candidate manifest');
  const fields = [
    'schema',
    'repository',
    'runId',
    'runAttempt',
    'baseCommit',
    'sourceCommit',
    'sourceTree',
    'upstreamTag',
    'upstreamCommit',
    'upstreamUrl',
    'patchTag',
    'testOutcome',
    'lintOutcome',
    'buildOutcome',
    'requiresApproval',
    'approvalEnvironmentId',
    'htmlSha256',
    'bundleSha256',
  ];
  if (
    Object.keys(value).length !== fields.length ||
    fields.some((name) => !Object.hasOwn(value, name))
  ) {
    throw new Error('Candidate manifest fields do not match schema 1');
  }
  if (typeof value.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(value.repository)) {
    throw new Error('Candidate repository is invalid');
  }
  for (const name of ['runId', 'runAttempt']) {
    if (typeof value[name] !== 'string' || !/^[1-9]\d*$/.test(value[name])) {
      throw new Error(`Candidate ${name} is invalid`);
    }
  }
  for (const name of ['baseCommit', 'sourceCommit', 'sourceTree', 'upstreamCommit']) {
    if (typeof value[name] !== 'string' || !/^[a-f0-9]{40}$/.test(value[name])) {
      throw new Error(`Candidate ${name} is invalid`);
    }
  }
  for (const name of ['upstreamTag', 'patchTag', 'upstreamUrl']) {
    if (typeof value[name] !== 'string' || !value[name] || /\s/.test(value[name])) {
      throw new Error(`Candidate ${name} is invalid`);
    }
  }
  const upstreamUrl = new URL(value.upstreamUrl as string);
  if (
    upstreamUrl.protocol !== 'https:' ||
    upstreamUrl.hostname !== 'github.com' ||
    upstreamUrl.username ||
    upstreamUrl.password ||
    upstreamUrl.search ||
    upstreamUrl.hash ||
    !upstreamUrl.pathname.includes('/releases/tag/')
  ) {
    throw new Error('Candidate upstream release URL is invalid');
  }
  if (typeof value.requiresApproval !== 'boolean')
    throw new Error('Candidate approval flag is invalid');
  const needsApproval = validationNeedsApproval({
    testOutcome: value.testOutcome as CheckOutcome,
    lintOutcome: value.lintOutcome as CheckOutcome,
    buildOutcome: value.buildOutcome as CheckOutcome,
    allowOverride: true,
  });
  if (needsApproval !== value.requiresApproval)
    throw new Error('Candidate approval policy is inconsistent');
  if (
    needsApproval
      ? typeof value.approvalEnvironmentId !== 'number' ||
        !Number.isSafeInteger(value.approvalEnvironmentId) ||
        value.approvalEnvironmentId <= 0
      : value.approvalEnvironmentId !== null
  ) {
    throw new Error('Candidate approval environment ID is invalid');
  }
  if (typeof value.htmlSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.htmlSha256)) {
    throw new Error('Candidate HTML checksum is invalid');
  }
  if (value.sourceCommit === value.baseCommit) {
    if (value.bundleSha256 !== null)
      throw new Error('An unchanged source must not include a bundle');
  } else if (typeof value.bundleSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.bundleSha256)) {
    throw new Error('Candidate bundle checksum is invalid');
  }
  return value as unknown as CandidateManifest;
}

/** Bind downloaded artifacts to this exact workflow attempt and independently supplied job outputs. */
export function validateCandidateContext(
  manifest: CandidateManifest,
  environment: Environment
): void {
  // GitHub approval history has no attempt identity, so an override must start a fresh workflow run.
  if (manifest.requiresApproval && manifest.runAttempt !== '1') {
    throw new Error(
      'Start a new Run workflow for validation overrides; reruns cannot reuse approval.'
    );
  }
  const expected = {
    repository: required(environment, 'GITHUB_REPOSITORY'),
    runId: required(environment, 'GITHUB_RUN_ID'),
    runAttempt: required(environment, 'GITHUB_RUN_ATTEMPT'),
  };
  for (const [name, value] of Object.entries(expected)) {
    if (manifest[name as keyof CandidateManifest] !== value)
      throw new Error(`Candidate ${name} does not match this workflow attempt`);
  }
  const inputs = {
    BASE_COMMIT: 'baseCommit',
    SOURCE_COMMIT: 'sourceCommit',
    UPSTREAM_TAG: 'upstreamTag',
    UPSTREAM_COMMIT: 'upstreamCommit',
    UPSTREAM_URL: 'upstreamUrl',
    PATCH_TAG: 'patchTag',
  } as const;
  for (const [name, field] of Object.entries(inputs)) {
    if (environment[name] !== undefined && manifest[field] !== environment[name]) {
      throw new Error(`Candidate ${field} does not match ${name}`);
    }
  }
  if (environment.ALLOW_VALIDATION_OVERRIDE !== undefined) {
    const allowed = environment.ALLOW_VALIDATION_OVERRIDE;
    if (allowed !== 'true' && allowed !== 'false')
      throw new Error('Invalid ALLOW_VALIDATION_OVERRIDE');
    validationNeedsApproval({ ...manifest, allowOverride: allowed === 'true' });
  }
}

/** Hash regular artifact files; symbolic links are not valid release assets or bundles. */
function sha256(path: string): string {
  if (!lstatSync(path).isFile()) throw new Error(`Candidate file is not a regular file: ${path}`);
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Check asset identity before consulting approval history or importing candidate Git objects. */
export function verifyCandidateFiles(directory: string, manifest: CandidateManifest): void {
  if (sha256(resolve(directory, 'management.html')) !== manifest.htmlSha256) {
    throw new Error('Candidate HTML checksum does not match');
  }
  const bundle = resolve(directory, 'candidate.bundle');
  if (manifest.bundleSha256 === null) {
    if (existsSync(bundle)) throw new Error('Candidate contains an unexpected bundle');
  } else if (sha256(bundle) !== manifest.bundleSha256) {
    throw new Error('Candidate bundle checksum does not match');
  }
}

/** Require the configured owner review gate and exactly one branch-only main deployment rule. */
function approvalEnvironmentId(repository: string, name: string): number {
  const endpoint = `repos/${name}/environments/${approvalEnvironment}`;
  const data = github(repository, endpoint);
  const id = validateApprovalEnvironment(data, reviewerId);
  if (!isRecord(data) || data.name !== approvalEnvironment)
    throw new Error('Approval environment name does not match');
  const policies = github(repository, `${endpoint}/deployment-branch-policies?per_page=100`);
  if (
    !isRecord(policies) ||
    policies.total_count !== 1 ||
    !Array.isArray(policies.branch_policies) ||
    policies.branch_policies.length !== 1 ||
    !isRecord(policies.branch_policies[0]) ||
    policies.branch_policies[0].name !== 'main' ||
    policies.branch_policies[0].type !== 'branch'
  ) {
    throw new Error('Approval environment must permit only the main branch');
  }
  return id;
}

/** Recheck live gate configuration and the owner's actual approval for this environment and run. */
function verifyApproval(repository: string, manifest: CandidateManifest): void {
  if (!manifest.requiresApproval) return;
  const id = approvalEnvironmentId(repository, manifest.repository);
  if (id !== manifest.approvalEnvironmentId) throw new Error('Approval environment was replaced');
  const history = github(
    repository,
    `repos/${manifest.repository}/actions/runs/${manifest.runId}/approvals`
  );
  if (!hasApprovedReview(history, id, reviewerId))
    throw new Error('Candidate has no matching human approval');
}

/** Confirm source ancestry and the exact upstream baseline recorded inside the candidate commit. */
function verifySource(repository: string, manifest: CandidateManifest): void {
  for (const tag of [manifest.upstreamTag, manifest.patchTag]) {
    command(repository, 'git', ['check-ref-format', `refs/tags/${tag}`]);
  }
  const source = command(repository, 'git', [
    'rev-parse',
    '--verify',
    `${manifest.sourceCommit}^{commit}`,
  ]).trim();
  const tree = command(repository, 'git', [
    'rev-parse',
    '--verify',
    `${manifest.sourceCommit}^{tree}`,
  ]).trim();
  if (source !== manifest.sourceCommit || tree !== manifest.sourceTree)
    throw new Error('Candidate source identity does not match');
  command(repository, 'git', [
    'merge-base',
    '--is-ancestor',
    manifest.baseCommit,
    manifest.sourceCommit,
  ]);
  command(repository, 'git', [
    'merge-base',
    '--is-ancestor',
    manifest.upstreamCommit,
    manifest.sourceCommit,
  ]);
  const state: unknown = JSON.parse(
    command(repository, 'git', ['show', `${manifest.sourceCommit}:.github/upstream-sync.json`])
  );
  if (
    !isRecord(state) ||
    state.upstreamTag !== manifest.upstreamTag ||
    state.upstreamCommit !== manifest.upstreamCommit
  ) {
    throw new Error('Candidate upstream baseline does not match its source commit');
  }
}

/** Produce public release notes without exposing internal diagnostics or approval configuration. */
export function releaseNotes(manifest: CandidateManifest): string {
  const run = `https://github.com/${manifest.repository}/actions/runs/${manifest.runId}`;
  return [
    `Based on upstream release [${manifest.upstreamTag}](${manifest.upstreamUrl}).`,
    '',
    `- Patch release: \`${manifest.patchTag}\``,
    `- Source commit: \`${manifest.sourceCommit}\``,
    `- Tests: ${manifest.testOutcome}; lint: ${manifest.lintOutcome}.`,
    `- [Workflow run](${run})`,
    ...(manifest.requiresApproval
      ? ['', 'Published after manual approval of failed validation checks.']
      : []),
    '',
  ].join('\n');
}

/** Package one committed, built source; preserve any logs already copied into the candidate directory. */
export function packCandidate(repository: string, environment: Environment): CandidateManifest {
  const allowOverride = required(environment, 'ALLOW_VALIDATION_OVERRIDE');
  if (allowOverride !== 'true' && allowOverride !== 'false')
    throw new Error('Invalid ALLOW_VALIDATION_OVERRIDE');
  const outcomes = {
    testOutcome: required(environment, 'TEST_OUTCOME') as CheckOutcome,
    lintOutcome: required(environment, 'LINT_OUTCOME') as CheckOutcome,
    buildOutcome: required(environment, 'BUILD_OUTCOME') as CheckOutcome,
  };
  const requiresApproval = validationNeedsApproval({
    ...outcomes,
    allowOverride: allowOverride === 'true',
  });
  const directory = resolve(required(environment, 'CANDIDATE_DIR'));
  const sourceCommit = required(environment, 'SOURCE_COMMIT');
  if (command(repository, 'git', ['rev-parse', 'HEAD']).trim() !== sourceCommit)
    throw new Error('Candidate source is not the current HEAD');
  if (command(repository, 'git', ['status', '--porcelain', '--untracked-files=no']).trim())
    throw new Error('Candidate source has uncommitted tracked changes');
  const manifest = parseCandidateManifest({
    schema: 1,
    repository: required(environment, 'GITHUB_REPOSITORY'),
    runId: required(environment, 'GITHUB_RUN_ID'),
    runAttempt: required(environment, 'GITHUB_RUN_ATTEMPT'),
    baseCommit: required(environment, 'BASE_COMMIT'),
    sourceCommit,
    sourceTree: command(repository, 'git', ['rev-parse', `${sourceCommit}^{tree}`]).trim(),
    upstreamTag: required(environment, 'UPSTREAM_TAG'),
    upstreamCommit: required(environment, 'UPSTREAM_COMMIT'),
    upstreamUrl: required(environment, 'UPSTREAM_URL'),
    patchTag: required(environment, 'PATCH_TAG'),
    ...outcomes,
    requiresApproval,
    approvalEnvironmentId: requiresApproval
      ? approvalEnvironmentId(repository, required(environment, 'GITHUB_REPOSITORY'))
      : null,
    htmlSha256: sha256(resolve(repository, 'dist/index.html')),
    bundleSha256: sourceCommit === environment.BASE_COMMIT ? null : '0'.repeat(64),
  });
  validateCandidateContext(manifest, environment);
  verifySource(repository, manifest);

  // Bundle only the new commits; the publishing checkout independently supplies the exact base.
  mkdirSync(directory, { recursive: true });
  copyFileSync(resolve(repository, 'dist/index.html'), resolve(directory, 'management.html'));
  if (manifest.sourceCommit !== manifest.baseCommit) {
    command(repository, 'git', [
      'bundle',
      'create',
      resolve(directory, 'candidate.bundle'),
      'HEAD',
      `^${manifest.baseCommit}`,
    ]);
    manifest.bundleSha256 = sha256(resolve(directory, 'candidate.bundle'));
  }
  writeFileSync(
    resolve(directory, 'changes.patch'),
    command(repository, 'git', ['diff', '--binary', manifest.baseCommit, manifest.sourceCommit])
  );
  const commits = command(repository, 'git', [
    'log',
    '-50',
    '--format=%h %s',
    `${manifest.baseCommit}..${manifest.sourceCommit}`,
  ]);
  writeFileSync(resolve(directory, 'commits.txt'), commits);
  writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(resolve(directory, 'release-notes.md'), releaseNotes(manifest));
  writeFileSync(
    resolve(directory, 'review.md'),
    [
      '# Prepared release candidate',
      '',
      releaseNotes(manifest).replace(
        'Published after manual approval of failed validation checks.',
        'Manual approval is required before publishing these failed validation checks.'
      ),
      `- Base commit: \`${manifest.baseCommit}\``,
      `- Source tree: \`${manifest.sourceTree}\``,
      `- Upstream commit: \`${manifest.upstreamCommit}\``,
      `- Build: ${manifest.buildOutcome}.`,
      `- Workflow attempt: ${manifest.runAttempt}.`,
      `- Approval required: ${manifest.requiresApproval}.`,
      `- HTML SHA-256: \`${manifest.htmlSha256}\``,
      '',
      'Candidate files include the source bundle, changes.patch and validation logs.',
      '',
      '## Source commits',
      '',
      '```text',
      commits.trim(),
      '```',
      '',
    ].join('\n')
  );
  verifyCandidateFiles(directory, manifest);
  if (environment.GITHUB_OUTPUT) {
    appendFileSync(
      environment.GITHUB_OUTPUT,
      `requires_approval=${manifest.requiresApproval}\nsource_commit=${manifest.sourceCommit}\n`
    );
  }
  return manifest;
}

/** Validate a downloaded artifact; full verification imports only local objects and reads remote main. */
export function inspectCandidate(
  repository: string,
  environment: Environment,
  full: boolean
): CandidateManifest {
  const directory = resolve(required(environment, 'CANDIDATE_DIR'));
  const manifest = parseCandidateManifest(
    JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'))
  );
  validateCandidateContext(manifest, environment);
  verifyCandidateFiles(directory, manifest);
  verifyApproval(repository, manifest);
  if (!full) return manifest;

  // A bundle cannot choose another ref or source; its sole advertised HEAD must match the manifest.
  if (manifest.bundleSha256 !== null) {
    const bundle = resolve(directory, 'candidate.bundle');
    command(repository, 'git', ['bundle', 'verify', bundle]);
    const heads = command(repository, 'git', ['bundle', 'list-heads', bundle]).trim();
    if (heads !== `${manifest.sourceCommit} HEAD`)
      throw new Error('Candidate bundle advertises unexpected source refs');
    command(repository, 'git', ['fetch', bundle, '+HEAD:refs/remotes/candidate/release']);
  }
  verifySource(repository, manifest);
  command(repository, 'git', ['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  if (
    command(repository, 'git', ['rev-parse', 'refs/remotes/origin/main']).trim() !==
    manifest.baseCommit
  ) {
    throw new Error('Origin main moved after candidate preparation; prepare a new candidate');
  }
  return manifest;
}

if (import.meta.main) {
  const operation = process.argv[2];
  if (operation === 'pack') {
    packCandidate(process.cwd(), process.env);
  } else if (operation === 'verify' || operation === 'approval') {
    const manifest = inspectCandidate(process.cwd(), process.env, operation === 'verify');
    if (operation === 'approval' && !manifest.requiresApproval)
      throw new Error('Candidate does not require an approval');
  } else {
    throw new Error('Usage: bun scripts/upstream/release-candidate.ts <pack|verify|approval>');
  }
  console.log(`Candidate ${operation} completed`);
}
