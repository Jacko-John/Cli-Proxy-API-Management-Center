/** Verify release entry points, candidate validation, and approval wiring independently of policy logic. */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

interface Step {
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
}

interface Job {
  uses?: string;
  with?: Record<string, unknown>;
  needs?: string | string[];
  if?: string;
  environment?: string | { name: string };
  concurrency?: unknown;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps?: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  concurrency?: { group: string; 'cancel-in-progress': boolean };
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

/** Read actual workflow YAML so policy tests cannot miss entry-point or job-level wiring errors. */
function workflow(path: string): Workflow {
  return parse(
    readFileSync(new URL(`../../.github/workflows/${path}`, import.meta.url), 'utf8')
  ) as Workflow;
}

const automatic = workflow('sync-upstream.yml');
const manual = workflow('manual-upstream-release.yml');
const shared = workflow('upstream-release.yml');
const { prepare, approval, publish } = shared.jobs;
const steps = prepare.steps ?? [];

/** Locate commands by responsibility; unrelated step renames should not affect the contract. */
function commandStep(command: string): { step: Step; index: number } {
  const index = steps.findIndex((step) => step.run?.includes(command));
  expect(index).toBeGreaterThanOrEqual(0);
  return { step: steps[index], index };
}

/** Format a step-output reference without relying on a particular step ID. */
function stepOutput(id: string | undefined, output: string): string {
  return '${{ steps.' + id + '.outputs.' + output + ' }}';
}

describe('upstream release entry points', () => {
  test.each([
    { entry: automatic, override: false, events: ['schedule', 'workflow_dispatch'] },
    { entry: manual, override: true, events: ['workflow_dispatch'] },
  ])('fixes override permission at the entry point ($override)', ({ entry, override, events }) => {
    expect(Object.keys(entry.on).sort()).toEqual(events.sort());
    const jobs = Object.values(entry.jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].uses).toBe('./.github/workflows/upstream-release.yml');
    expect(jobs[0].with?.allow_validation_override).toBe(override);
    expect(jobs[0].with?.upstream_tag).toContain('inputs.upstream_tag');
    expect(jobs[0].with?.force_release).toContain('inputs.force_release');
    expect(entry.permissions ?? jobs[0].permissions).toEqual({
      contents: 'write',
      actions: 'read',
    });
    // A caller lock would deadlock the called workflow; the shared pipeline owns the lock.
    expect(entry.concurrency).toBeUndefined();
    expect(jobs[0].concurrency).toBeUndefined();
    const dispatch = entry.on.workflow_dispatch as { inputs: Record<string, unknown> };
    expect(dispatch.inputs.allow_validation_override).toBeUndefined();
  });

  test('serializes the shared pipeline including its approval wait', () => {
    expect(Object.keys(shared.on)).toEqual(['workflow_call']);
    const call = shared.on.workflow_call as {
      inputs: Record<string, { type: string; default: unknown }>;
    };
    expect(call.inputs.allow_validation_override).toEqual({ type: 'boolean', default: false });
    expect(shared.concurrency).toEqual({
      group: 'sync-upstream-release-main',
      'cancel-in-progress': false,
    });
    expect(Object.keys(shared.jobs).sort()).toEqual(['approval', 'prepare', 'publish']);
    for (const job of Object.values(shared.jobs)) expect(job.concurrency).toBeUndefined();
  });

  test('rejects non-main runs and non-dispatch overrides before checking out source', () => {
    const entry = steps[0];
    expect(entry.env?.WORKFLOW_REF).toBe('${{ github.ref }}');
    expect(entry.env?.WORKFLOW_EVENT).toBe('${{ github.event_name }}');
    expect(entry.env?.ALLOW_VALIDATION_OVERRIDE).toBe('${{ inputs.allow_validation_override }}');
    expect(entry.run).toContain('test "${WORKFLOW_REF}" = refs/heads/main');
    expect(entry.run).toContain('test "${WORKFLOW_EVENT}" = workflow_dispatch');
    expect(steps.find((step) => step.uses === 'actions/checkout@v4')?.with?.ref).toBe('main');
  });
});

describe('upstream candidate preparation', () => {
  test('sets up package-pinned Bun before bootstrap and again before target validation', () => {
    const setups = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.uses === 'oven-sh/setup-bun@v2');
    expect(setups).toHaveLength(2);
    for (const { step } of setups) {
      expect(step.with?.['bun-version-file']).toBe('package.json');
      expect(Object.prototype.hasOwnProperty.call(step.with ?? {}, 'bun-version')).toBe(false);
    }
    const bootstrap = commandStep('bun install --frozen-lockfile');
    const source = commandStep('bun scripts/sync-upstream.ts');
    const dependencies = commandStep('bun install --lockfile-only');
    expect(setups[0].index).toBeLessThan(bootstrap.index);
    expect(source.index).toBeGreaterThan(bootstrap.index);
    expect(setups[1].index).toBeGreaterThan(source.index);
    expect(dependencies.index).toBeGreaterThan(setups[1].index);
    expect(commandStep('bun run test').index).toBeGreaterThan(dependencies.index);
  });

  test('collects actual test and lint outcomes but requires a production build', () => {
    const tests = commandStep('bun run test');
    const lint = commandStep('bun run lint');
    const build = commandStep('bun run build');
    const candidate = commandStep('release-candidate.ts pack');
    expect(tests.step['continue-on-error']).toBe(true);
    expect(lint.step['continue-on-error']).toBe(true);
    expect(build.step['continue-on-error'] ?? false).toBe(false);
    expect(lint.index).toBeGreaterThan(tests.index);
    expect(build.index).toBeGreaterThan(lint.index);
    expect(candidate.index).toBeGreaterThan(build.index);
    for (const step of [tests.step, lint.step, build.step]) {
      expect(step.id).toBeDefined();
      expect(step.run).toContain('set -euo pipefail');
    }
    // continue-on-error changes conclusion to success, so policy must consume the original outcome.
    expect(candidate.step.env?.TEST_OUTCOME).toBe('${{ steps.' + tests.step.id + '.outcome }}');
    expect(candidate.step.env?.LINT_OUTCOME).toBe('${{ steps.' + lint.step.id + '.outcome }}');
    expect(candidate.step.env?.BUILD_OUTCOME).toBe('${{ steps.' + build.step.id + '.outcome }}');
    expect(candidate.step.env?.ALLOW_VALIDATION_OVERRIDE).toBe(
      '${{ inputs.allow_validation_override }}'
    );
    expect(candidate.step['continue-on-error'] ?? false).toBe(false);
    expect(candidate.step.if).not.toContain('always()');
    expect(steps.some((step) => step.run?.includes('bun run verify'))).toBe(false);
  });

  test('uploads an immutable candidate and requires packaging plus upload success for readiness', () => {
    const upload = steps.find((step) => step.uses === 'actions/upload-artifact@v4' && step.id);
    const candidate = commandStep('release-candidate.ts pack').step;
    expect(upload).toBeDefined();
    expect(upload?.with?.overwrite ?? false).toBe(false);
    expect(upload?.with?.['if-no-files-found']).toBe('error');
    expect(upload?.with?.name).toContain('github.run_id');
    expect(upload?.with?.name).toContain('github.run_attempt');
    expect(prepare.outputs?.ready).toContain(`steps.${candidate.id}.outcome == 'success'`);
    expect(prepare.outputs?.ready).toContain(`steps.${upload?.id}.outcome == 'success'`);
    expect(prepare.outputs?.artifact_id).toBe(stepOutput(upload?.id, 'artifact-id'));
    expect(prepare.outputs?.requires_approval).toBe(stepOutput(candidate.id, 'requires_approval'));
  });
});

describe('approval and publication gates', () => {
  test('requests protected-environment approval only for an explicit manual override candidate', () => {
    expect(approval.needs).toBe('prepare');
    expect(approval.if).toContain("needs.prepare.outputs.ready == 'true'");
    expect(approval.if).toContain("needs.prepare.outputs.requires_approval == 'true'");
    expect(approval.if).toContain('inputs.allow_validation_override');
    expect(approval.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(approval.if).toContain("github.ref == 'refs/heads/main'");
    const environment = approval.environment;
    expect(typeof environment === 'string' ? environment : environment?.name).toBe(
      'manual-release-override'
    );
    expect(
      approval.steps?.some((step) => step.run?.includes('release-candidate.ts approval'))
    ).toBe(true);
  });

  test('requires successful preparation and an explicit approval decision before publishing', () => {
    expect(publish.needs).toEqual(['prepare', 'approval']);
    expect(publish.if).toContain('!cancelled()');
    expect(publish.if).toContain("needs.prepare.result == 'success'");
    expect(publish.if).toContain("needs.prepare.outputs.ready == 'true'");
    expect(publish.if).toContain("needs.prepare.outputs.requires_approval == 'false'");
    expect(publish.if).toContain("needs.prepare.outputs.requires_approval == 'true'");
    expect(publish.if).toContain('inputs.allow_validation_override');
    expect(publish.if).toContain("needs.approval.result == 'success'");
    expect(publish.if).not.toContain("needs.prepare.outputs.requires_approval != 'true'");
    expect(publish.permissions).toEqual({ contents: 'write', actions: 'read' });
  });

  test.each([approval, publish])(
    'uses the exact prepared artifact and trusted base tooling',
    (job) => {
      const checkout = job.steps?.find((step) => step.uses === 'actions/checkout@v4');
      const download = job.steps?.find((step) => step.uses === 'actions/download-artifact@v4');
      expect(checkout?.with?.ref).toBe('${{ needs.prepare.outputs.base_commit }}');
      expect(download?.with?.['artifact-ids']).toBe('${{ needs.prepare.outputs.artifact_id }}');
      expect(download?.with?.name).toBeUndefined();
      const verification = job.steps?.find((step) => step.run?.includes('release-candidate.ts'));
      expect(verification?.env?.BASE_COMMIT).toBe('${{ needs.prepare.outputs.base_commit }}');
      expect(verification?.env?.SOURCE_COMMIT).toBe('${{ needs.prepare.outputs.source_commit }}');
      expect(verification?.env?.PATCH_TAG).toBe('${{ needs.prepare.outputs.patch_tag }}');
    }
  );

  test('verifies the candidate before pushing its exact commit and prepared asset', () => {
    const publication = publish.steps ?? [];
    const verify = publication.findIndex((step) =>
      step.run?.includes('release-candidate.ts verify')
    );
    const push = publication.findIndex((step) => step.run?.includes('git push origin'));
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(push).toBeGreaterThan(verify);
    expect(publication[push].run).toContain('"${SOURCE_COMMIT}:refs/heads/main"');
    expect(publication[push].run).not.toContain('--force');
    expect(publication[push].run).toContain('"${CANDIDATE_DIR}/management.html"');
    expect(publication[push].run).toContain('--target "${SOURCE_COMMIT}"');
    expect(publication.some((step) => step.run?.includes('bun run build'))).toBe(false);
  });
});
