/** Keep synchronization on the package's current toolchain before and after an upstream upgrade. */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

interface WorkflowStep {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

const workflow = parse(
  readFileSync(new URL('../../.github/workflows/sync-upstream.yml', import.meta.url), 'utf8')
) as { jobs: { 'sync-upstream-release': { steps: WorkflowStep[] } } };
const steps = workflow.jobs['sync-upstream-release'].steps;

describe('upstream synchronization toolchain', () => {
  test('sets up the package-pinned Bun before bootstrap and again before target verification', () => {
    const setups = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.uses === 'oven-sh/setup-bun@v2');
    expect(setups).toHaveLength(2);
    for (const { step } of setups) {
      expect(step.with?.['bun-version-file']).toBe('package.json');
      expect(Object.hasOwn(step.with ?? {}, 'bun-version')).toBe(false);
    }

    // Dependency installation must use the package version from the corresponding source tree.
    const bootstrap = steps.findIndex((step) => step.run === 'bun install --frozen-lockfile');
    const prepare = steps.findIndex((step) => step.run?.includes('bun scripts/sync-upstream.ts'));
    const dependencies = steps.findIndex((step) =>
      step.run?.includes('bun install --lockfile-only')
    );
    const verify = steps.findIndex((step) => step.run === 'bun run verify');
    expect(bootstrap).toBeGreaterThanOrEqual(0);
    expect(prepare).toBeGreaterThan(bootstrap);
    expect(setups[0].index).toBeLessThan(bootstrap);
    expect(setups[1].index).toBeGreaterThan(prepare);
    expect(dependencies).toBeGreaterThan(setups[1].index);
    expect(verify).toBeGreaterThan(dependencies);
  });
});
