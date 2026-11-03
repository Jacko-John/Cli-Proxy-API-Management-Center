/** Keep the upstream package and toolchain authoritative while adding plugin-only dependencies. */
import { isDeepStrictEqual } from 'node:util';
import { blob } from './git';

export const pluginDependencies = {
  'chart.js': '^4.5.1',
  'react-chartjs-2': '^5.3.1',
} as const;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

/** Read an upstream package; an absent package cannot supply the shared build contract. */
function readPackage(repository: string, ref: string): PackageJson {
  const source = blob(repository, ref, 'package.json');
  if (source === null) throw new Error(`${ref}: missing upstream package.json`);
  return JSON.parse(source);
}

/** Add only missing chart dependencies, preserving every version already selected by upstream. */
function withPluginDependencies(upstream: PackageJson): PackageJson {
  const result = structuredClone(upstream);
  const sections = [
    upstream.dependencies,
    upstream.devDependencies,
    upstream.optionalDependencies,
    upstream.peerDependencies,
  ];
  for (const [name, version] of Object.entries(pluginDependencies)) {
    if (sections.some((section) => section && Object.hasOwn(section, name))) continue;
    result.dependencies ??= {};
    result.dependencies[name] = version;
  }
  return result;
}

/** Prepare a package from the exact release; CI resolves its lockfile with that release's Bun. */
export function generatePackageJson(repository: string, upstream: string): string {
  return JSON.stringify(withPluginDependencies(readPackage(repository, upstream)), null, 2) + '\n';
}

/** Reject unregistered package edits before adopting the next upstream package. */
export function validatePackageChanges(
  repository: string,
  baseline: string,
  allowLegacyIsolation: boolean
): void {
  const upstream = readPackage(repository, baseline);
  const ours = readPackage(repository, 'HEAD');
  const expected = withPluginDependencies(upstream);
  if (isDeepStrictEqual(ours, expected)) return;

  // Retire the historical test-script override once; the shared scripts now follow upstream.
  if (allowLegacyIsolation && upstream.scripts?.test === 'bun test') {
    const legacy = structuredClone(expected);
    legacy.scripts = { ...legacy.scripts, test: 'bun test --isolate' };
    if (isDeepStrictEqual(ours, legacy)) return;
  }
  throw new Error('package.json: fork edits are outside the registered plugin dependencies');
}
