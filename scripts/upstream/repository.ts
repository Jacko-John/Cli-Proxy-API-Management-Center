/** Track the upstream baseline and the complete set of files owned by the plugin extension. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePackageChanges } from './data-files';
import { blob, git, treePaths } from './git';

const statePath = '.github/upstream-sync.json';

// Reserve only namespaces absent from upstream; files in shared directories are listed individually.
export const forkOwnedPaths = [
  statePath,
  '.github/workflows/sync-upstream.yml',
  '.github/workflows/manual-upstream-release.yml',
  '.github/workflows/upstream-release.yml',
  'FORK.md',
  'scripts/upstream',
  'scripts/sync-upstream.ts',
  'scripts/apply-fork-patches.ts',
  'src/components/credentialCenter',
  'src/components/monitor',
  'src/components/usage',
  'src/components/layout/forkSidebarIcons.tsx',
  'src/features/notifications',
  'src/features/safety',
  'src/fork',
  'src/i18n/forkTranslations.ts',
  'src/i18n/notificationTranslations.ts',
  'src/pages/CredentialCenterPage.tsx',
  'src/pages/CredentialCenterPage.module.scss',
  'src/pages/MonitoringCenterPage.tsx',
  'src/pages/MonitoringCenterPage.module.scss',
  'src/pages/UsagePage.module.scss',
  'src/services/api/notifications.ts',
  'src/services/api/usage.ts',
  'src/services/api/usagePluginClient.ts',
  'src/stores/useUsageStatsStore.ts',
  'src/styles/fork-mixins.scss',
  'src/types/sourceInfo.ts',
  'src/types/usage.ts',
  'src/types/usageSafety.ts',
  'src/utils/credentialUsage.ts',
  'src/utils/priceSync.ts',
  'src/utils/sourceResolver.ts',
  'src/utils/tierMultiplier.ts',
  'src/utils/usage.ts',
  'src/utils/usage',
  'src/utils/usageTimeRange.ts',
  'tests/fork',
  'tests/antigravityCredentialQuota.test.ts',
  'tests/cacheHitRatio.test.ts',
  'tests/forkNavigation.test.ts',
  'tests/forkTranslations.test.ts',
  'tests/notificationSMTPProfiles.test.ts',
  'tests/notificationSMTPSettings.test.ts',
  'tests/safetyCenterLogic.test.ts',
  'tests/usageApi.test.ts',
  'tests/usageNotifications.test.ts',
  'tests/usageNotificationsApi.test.ts',
  'tests/usagePrecomputed.test.ts',
  'tests/usageSafetyApi.test.ts',
] as const;

// These are the audited pre-migration blobs from 844e2eb9, not permanent override permissions.
const legacyForkBlobs: Record<string, string> = {
  'README.md': 'f8d6193bfa8988cba760462a8d6f532ffa261bbe',
  'AGENTS.md': 'eb032d4e4266b21431a6efbbb9b2e9ffa3117c1b',
  'src/i18n/locales/ru.json': '9843cb8c980f7a2d44885b8b16c96cf147821224',
  'src/i18n/locales/zh-CN.json': '72064c35316075d140ed696e659c76228b487ecc',
  'src/i18n/locales/zh-TW.json': '1d6ce59a741a597622eacf894a9ba2b4e94f5bbc',
};

interface UpstreamState {
  upstreamTag: string;
  upstreamCommit: string;
  strategy?: 'upstream-snapshot';
}

/** Read the shared baseline used by synchronization and development patch generation. */
export function readUpstreamState(repository: string): UpstreamState {
  return JSON.parse(readFileSync(resolve(repository, statePath), 'utf8'));
}

/** Stage the prepared baseline after the snapshot and plugin overlay have been written. */
export function writeUpstreamState(repository: string, state: UpstreamState): void {
  writeFileSync(resolve(repository, statePath), JSON.stringify(state, null, 2) + '\n');
  git(repository, ['add', '--', statePath]);
}

/** Test extension membership without claiming a shared directory such as src/utils or tests. */
export function isForkOwnedPath(path: string): boolean {
  return forkOwnedPaths.some((owned) => path === owned || path.startsWith(`${owned}/`));
}

/** Reject extension namespace collisions, including files that obstruct a reserved parent path. */
export function validateForkOwnership(repository: string, upstream: string): void {
  // Inspect tree entries rather than diffs: identical additions and new child files can merge cleanly.
  const collisions = treePaths(repository, upstream).filter((path) =>
    forkOwnedPaths.some(
      (owned) => path === owned || path.startsWith(`${owned}/`) || owned.startsWith(`${path}/`)
    )
  );
  if (collisions.length) {
    throw new Error(
      `${upstream}: upstream occupies fork extension paths; resolve ownership before synchronization:\n${collisions.join('\n')}`
    );
  }
}

/** Recognize only the audited historical docs/catalogs and the old frontend-repository link. */
function isLegacyForkChange(repository: string, baseline: string, path: string): boolean {
  const expectedBlob = legacyForkBlobs[path];
  if (expectedBlob) {
    return git(repository, ['rev-parse', `HEAD:${path}`], true).stdout.trim() === expectedBlob;
  }
  if (path !== 'src/pages/SystemPage.tsx') return false;
  const ours = blob(repository, 'HEAD', path);
  const original = blob(repository, baseline, path);
  return (
    ours !== null &&
    original !== null &&
    ours.replaceAll(
      'https://github.com/Fwindy/Cli-Proxy-API-Management-Center',
      'https://github.com/router-for-me/Cli-Proxy-API-Management-Center'
    ) === original
  );
}

/** Refuse to discard any unregistered fork change before the checkout or index is touched. */
export function validateForkChanges(
  repository: string,
  baseline: string,
  integrationPaths: string[],
  allowLegacyMigration: boolean
): void {
  const integrations = new Set(integrationPaths);
  const changed = git(repository, ['diff', '--no-renames', '--name-only', '-z', baseline, 'HEAD'])
    .stdout.split('\0')
    .filter(Boolean);
  const unknown = changed.filter((path) => {
    if (isForkOwnedPath(path) || integrations.has(path)) return false;
    if (path === 'package.json' || path === 'bun.lock') return false;
    return !allowLegacyMigration || !isLegacyForkChange(repository, baseline, path);
  });
  if (unknown.length) {
    throw new Error(`Unregistered fork changes would be overwritten:\n${unknown.join('\n')}`);
  }
  validatePackageChanges(repository, baseline, allowLegacyMigration);
}

/** Restore committed extension blobs byte for byte after replacing the upstream-owned tree. */
export function restoreForkPaths(repository: string, before: string): void {
  const paths = treePaths(repository, before).filter(isForkOwnedPath);
  if (paths.length) {
    git(repository, ['restore', `--source=${before}`, '--staged', '--worktree', '--', ...paths]);
  }
}
