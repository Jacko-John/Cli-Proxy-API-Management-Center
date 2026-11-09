/** Exercise upstream ownership and plugin preservation with independent, real Git histories. */
import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { syncUpstream } from '../../scripts/sync-upstream';
import { formatSource } from '../../scripts/upstream/ast';
import { git } from '../../scripts/upstream/git';
import { patchUpstreamSource, sourcePatches } from '../../scripts/upstream/source-patches';

const directories: string[] = [];

// Every test owns its temporary repository, including failures before synchronization starts.
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Write a fixture file without depending on the synchronizer's serialization. */
function write(repository: string, path: string, content: string | object): void {
  mkdirSync(dirname(join(repository, path)), { recursive: true });
  writeFileSync(
    join(repository, path),
    typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n'
  );
}

const read = (repository: string, path: string) => readFileSync(join(repository, path), 'utf8');
const json = (repository: string, path: string) => JSON.parse(read(repository, path));

/** Commit fixture changes so synchronization always starts from an explicit clean tree. */
function commit(repository: string): void {
  git(repository, ['add', '.']);
  git(repository, ['commit', '-qm', 'Sync fixture']);
}

// These sources model upstream integration contracts independently of the patch implementation.
const sources: Record<string, string> = {
  'src/i18n/index.ts': `import i18n from 'i18next';
    import en from './locales/en.json';
    i18n.init({ resources: { en: { translation: en } } });
    export default i18n;`,
  'src/router/MainRoutes.tsx': `import { useRoutes } from 'react-router-dom';
    const createMainRoutes = (supportsPlugin: boolean) => [
      { path: '/', element: 'dashboard' },
      ...(supportsPlugin ? [{ path: '/plugins', element: 'plugins' }] : []),
      { path: '*', element: 'fallback' },
    ];
    export function MainRoutes() { return useRoutes(createMainRoutes(true)); }`,
  'src/components/layout/MainLayout.tsx': `import { useState } from 'react';
    interface SidebarNavGroup { id: string; items: unknown[]; }
    export function MainLayout() {
      const [pluginResources, setPluginResources] = useState([]);
      const loadPluginResources = async () => {
        if (!connected) { setPluginResources([]); return; }
        try {
          const response = await pluginsApi.list();
          setPluginResources(collectPluginResourceEntries(response.plugins));
        } catch { setPluginResources([]); }
      };
      const navGroups: SidebarNavGroup[] = [
        { id: 'observe', items: [{ path: '/quota' }, { path: '/logs' }] },
        { id: 'control', items: [{ path: '/config' }] },
      ];
      return navGroups;
    }`,
  'src/pages/SystemPage.tsx': `export function SystemPage() {
      return <a href="https://github.com/router-for-me/Cli-Proxy-API-Management-Center">Frontend</a>;
    }`,
  'src/services/api/index.ts': `export * from './client';`,
  'src/types/index.ts': `export * from './config';`,
  'tests/authFileCooldowns.test.ts': `import { describe, expect, test } from 'bun:test';
    const i18n = { t: () => "Clear this credential's local routing cooldown" };
    describe('cooldown section rendering', () => {
      test('keeps the reset action contextual and exposes pending state', () => {
        const available = '<button title="Clear this credential&#x27;s local routing cooldown">Reset</button>';
        expect(available).toContain('<button');
        expect(available).toContain(i18n.t('auth_files.cooldown_reset_hint'));
        expect(available).not.toContain('disabled=""');
        const pending = '<button disabled="">Reset</button>';
        expect(pending).toContain('disabled=""');
      });
    });`,
};

// Independent plugin examples cover complete feature roots and individually owned leaf files.
const pluginSources: Record<string, string> = {
  'FORK.md': '# Plugin management extensions\n',
  '.github/workflows/sync-upstream.yml': 'name: Automatic plugin release\n',
  '.github/workflows/manual-upstream-release.yml': 'name: Approved plugin release\n',
  '.github/workflows/upstream-release.yml': 'name: Shared plugin release pipeline\n',
  'src/fork/sentinel.ts': 'export const feature = "preserve me";\n',
  'src/features/notifications/UsageNotificationsPage.tsx': 'export const page = "notifications";\n',
  'src/features/notifications/NotificationSMTPSettings.tsx':
    'export const accounts = "multiple";\n',
  'src/features/notifications/UsageNotificationsPage.module.scss': '.page { display: grid; }\n',
  'src/features/safety/SafetyCenterPage.tsx': 'export const safety = "plugin";\n',
  'src/components/monitor/MonitorStatCards.tsx': 'export const monitoring = "plugin";\n',
  'src/components/credentialCenter/CredentialStatsCard.tsx':
    'export const credentials = "plugin";\n',
  'src/components/usage/ModelStatsCard.tsx': 'export const statistics = "plugin";\n',
  'src/pages/MonitoringCenterPage.tsx': 'export const monitor = "plugin";\n',
  'src/pages/CredentialCenterPage.tsx': 'export const credentialsPage = "plugin";\n',
  'src/i18n/forkTranslations.ts': 'export const overlay = true;\n',
  'src/i18n/notificationTranslations.ts': 'export const senderLabel = "Sender";\n',
  'src/services/api/notifications.ts': 'export const settings = "smtp_profiles";\n',
  'src/services/api/usagePluginClient.ts': 'export const transport = "plugin";\n',
  'src/services/api/usage.ts': 'export const usage = "plugin";\n',
  'src/types/usage.ts': 'export type Usage = "plugin";\n',
  'src/utils/usageTimeRange.ts': 'export const range = "plugin";\n',
  'tests/fork/pluginFixture.test.ts': 'export const independentTest = "preserve";\n',
};

const binaryPayload = Buffer.from([0, 255, 128, 13, 10, 0, 254]);

/** Check content, executable mode, binary bytes and symlinks independently of the ownership list. */
function expectPluginsPreserved(repository: string): void {
  for (const [path, source] of Object.entries(pluginSources)) {
    expect(read(repository, path)).toBe(source);
  }
  expect(readFileSync(join(repository, 'src/fork/fixture.bin'))).toEqual(binaryPayload);
  expect(lstatSync(join(repository, 'src/fork/run-fixture.sh')).mode & 0o111).toBe(0o111);
  expect(read(repository, 'src/fork/run-fixture.sh')).toBe('#!/bin/sh\nexit 0\n');
  expect(lstatSync(join(repository, 'src/fork/fixture-link')).isSymbolicLink()).toBe(true);
  expect(readlinkSync(join(repository, 'src/fork/fixture-link'))).toBe('sentinel.ts');
}

/** Require failed preflight to leave HEAD, index, worktree and baseline untouched. */
async function expectPreflightFailure(
  repository: string,
  tag: string,
  message: string
): Promise<void> {
  const before = git(repository, ['rev-parse', 'HEAD']).stdout;
  const state = read(repository, '.github/upstream-sync.json');
  await expect(syncUpstream(repository, tag)).rejects.toThrow(message);
  expect(git(repository, ['rev-parse', 'HEAD']).stdout).toBe(before);
  expect(git(repository, ['status', '--porcelain']).stdout).toBe('');
  expect(git(repository, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], true).exitCode).not.toBe(0);
  expect(read(repository, '.github/upstream-sync.json')).toBe(state);
}

/** Build a legal plugin fork without unrelated modifications to upstream-owned business files. */
async function fixture(): Promise<string> {
  const repository = mkdtempSync(join(tmpdir(), 'cpa-upstream-sync-'));
  directories.push(repository);
  git(repository, ['init', '-q', '--initial-branch=main']);
  git(repository, ['config', 'user.name', 'Sync fixture']);
  git(repository, ['config', 'user.email', 'sync-fixture@example.invalid']);
  git(repository, ['config', 'commit.gpgsign', 'false']);
  git(repository, ['config', 'core.hooksPath', join(repository, '.git/disabled-hooks')]);
  for (const [path, source] of Object.entries(sources)) write(repository, path, source);
  write(repository, 'src/i18n/locales/en.json', {
    title: 'Dashboard',
    legacyMissing: 'English fallback',
  });
  write(repository, 'src/i18n/locales/vi.json', { title: 'Bảng điều khiển' });
  write(repository, 'package.json', {
    packageManager: 'bun@1.3.14',
    scripts: { test: 'bun test', verify: 'bun run test' },
    dependencies: { core: '1.0.0' },
  });
  write(repository, 'bun.lock', { lockfileVersion: 1, packages: { core: ['core@1.0.0'] } });
  write(repository, 'README.md', 'Upstream documentation using **Bun 1.3.14**\n');
  write(repository, 'AGENTS.md', 'Use `bun@1.3.14` for upstream development.\n');
  write(repository, '.github/workflows/ci.yml', "bun-version: '1.3.14'\n");
  write(repository, '.github/workflows/release.yml', "bun-version: '1.3.14'\n");
  write(repository, 'application.ts', 'export const value = "base";\n');
  write(repository, 'shared/helper.ts', 'export const helper = true;\n');
  write(repository, 'options.json', { limit: 1, inherited: true });
  write(repository, 'redundant.json', { enabled: false });
  commit(repository);
  const baseline = git(repository, ['rev-parse', 'HEAD']).stdout.trim();
  git(repository, ['branch', 'upstream']);

  // The plugin contributes only its declared files, chart dependencies and generated integrations.
  write(repository, '.github/upstream-sync.json', {
    upstreamTag: 'base',
    upstreamCommit: baseline,
  });
  for (const path of Object.keys(sourcePatches)) {
    write(repository, path, await patchUpstreamSource(path, sources[path]));
  }
  for (const [path, source] of Object.entries(pluginSources)) write(repository, path, source);
  writeFileSync(join(repository, 'src/fork/fixture.bin'), binaryPayload);
  write(repository, 'src/fork/run-fixture.sh', '#!/bin/sh\nexit 0\n');
  chmodSync(join(repository, 'src/fork/run-fixture.sh'), 0o755);
  symlinkSync('sentinel.ts', join(repository, 'src/fork/fixture-link'));
  write(repository, 'package.json', {
    packageManager: 'bun@1.3.14',
    scripts: { test: 'bun test', verify: 'bun run test' },
    dependencies: { core: '1.0.0', 'chart.js': '^4.5.1', 'react-chartjs-2': '^5.3.1' },
  });
  commit(repository);
  return repository;
}

/** Advance only the upstream branch and tag it, then restore the fork's clean checkout. */
function upstreamRelease(repository: string, tag: string, update: () => void): void {
  git(repository, ['checkout', '-q', 'upstream']);
  update();
  commit(repository);
  git(repository, ['tag', tag]);
  git(repository, ['checkout', '-q', 'main']);
}

describe('plugin source synchronization', () => {
  test('rejects upstream navigation collisions and missing groups before release', async () => {
    await expect(
      patchUpstreamSource(
        'src/router/MainRoutes.tsx',
        sources['src/router/MainRoutes.tsx'].replace("path: '/'", "path: '/monitor'")
      )
    ).rejects.toThrow('conflicts with the fork extension');
    await expect(
      patchUpstreamSource(
        'src/components/layout/MainLayout.tsx',
        sources['src/components/layout/MainLayout.tsx'].replace(
          "id: 'observe'",
          "id: 'renamed-observation-group'"
        )
      )
    ).rejects.toThrow('group observe is missing');
  });

  test('preserves conditional setter execution when upstream removes braces', async () => {
    const original = sources['src/components/layout/MainLayout.tsx'].replace(
      'if (!connected) { setPluginResources([]); return; }',
      'if (!connected) setPluginResources([]);'
    );
    const patched = await patchUpstreamSource('src/components/layout/MainLayout.tsx', original);
    const tree = ts.createSourceFile('MainLayout.tsx', patched, ts.ScriptTarget.Latest, true);
    const branches: ts.IfStatement[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isIfStatement(node)) branches.push(node);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(branches).toHaveLength(1);
    const branch = branches[0].thenStatement;
    expect(ts.isBlock(branch)).toBe(true);
    if (ts.isBlock(branch)) {
      expect(branch.statements).toHaveLength(2);
      expect(branch.statements[1].getText()).toBe('setSafetyPluginAvailable(false);');
    }
  });

  test('preserves plugins while adopting exact upstream changes, renames and deletions', async () => {
    const repository = await fixture();
    upstreamRelease(repository, 'release-1', () => {
      write(
        repository,
        'src/i18n/index.ts',
        sources['src/i18n/index.ts']
          .replace(
            "import en from './locales/en.json';",
            "// New upstream language\nimport en from './locales/en.json';\nimport vi from './locales/vi.json';"
          )
          .replace('en: { translation: en }', 'en: { translation: en }, vi: { translation: vi }')
      );
      write(
        repository,
        'src/router/MainRoutes.tsx',
        sources['src/router/MainRoutes.tsx']
          .replace("{ path: '/',", "{ path: '/new-page', element: 'new' },\n{ path: '/',")
          .replaceAll('supportsPlugin', 'available')
      );
      write(
        repository,
        'src/components/layout/MainLayout.tsx',
        sources['src/components/layout/MainLayout.tsx']
          .replace("{ path: '/logs' }", "{ path: '/new-metric' }, { path: '/logs' }")
          .replace('response.plugins', 'response.entries')
      );
      write(
        repository,
        'src/services/api/index.ts',
        "export * from './newUpstreamApi';\n" + sources['src/services/api/index.ts']
      );
      write(repository, 'package.json', {
        packageManager: 'bun@1.4.3',
        scripts: { test: 'bun test', verify: 'bun run test', lint: 'upstream lint' },
        dependencies: { core: '2.0.0', newDependency: '1.0.0' },
      });
      write(repository, 'bun.lock', {
        lockfileVersion: 1,
        packages: { core: ['core@2.0.0'], newDependency: ['newDependency@1.0.0'] },
      });
      write(repository, 'README.md', 'Changed upstream documentation using **Bun 1.4.3**\n');
      write(repository, 'AGENTS.md', 'Use `bun@1.4.3` for upstream development.\n');
      write(repository, '.github/workflows/ci.yml', "bun-version: '1.4.3'\n");
      write(repository, '.github/workflows/release.yml', "bun-version: '1.4.3'\n");
      write(repository, 'options.json', { limit: 2, upstreamFlag: true });
      git(repository, ['rm', 'redundant.json']);
    });
    await syncUpstream(repository, 'release-1');
    expect(read(repository, 'src/router/MainRoutes.tsx')).toContain("'/new-page'");
    expect(read(repository, 'src/router/MainRoutes.tsx')).toContain('extendForkRoutes(');
    expect(read(repository, 'src/components/layout/MainLayout.tsx')).toContain(
      'isUsagePluginAvailable(response.entries)'
    );
    expect(read(repository, 'src/components/layout/MainLayout.tsx')).toContain("'/new-metric'");
    expect(read(repository, 'src/i18n/index.ts')).toContain('vi: { translation: vi }');
    expect(read(repository, 'src/i18n/index.ts')).toContain('registerForkTranslations(i18n)');
    expect(read(repository, 'src/services/api/index.ts')).toContain("'./newUpstreamApi'");
    expect(read(repository, 'src/services/api/index.ts')).toContain("'./usage'");
    expect(json(repository, 'package.json')).toEqual({
      packageManager: 'bun@1.4.3',
      scripts: { test: 'bun test', verify: 'bun run test', lint: 'upstream lint' },
      dependencies: {
        core: '2.0.0',
        newDependency: '1.0.0',
        'chart.js': '^4.5.1',
        'react-chartjs-2': '^5.3.1',
      },
    });
    for (const path of [
      'bun.lock',
      'README.md',
      'AGENTS.md',
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      'src/pages/SystemPage.tsx',
      'options.json',
    ]) {
      expect(read(repository, path)).toBe(git(repository, ['show', `release-1:${path}`]).stdout);
    }
    expect(existsSync(join(repository, 'redundant.json'))).toBe(false);
    expectPluginsPreserved(repository);
    commit(repository);

    // Further releases keep their native catalogs and file lifecycle without accumulating patches.
    upstreamRelease(repository, 'release-2', () => {
      write(repository, 'src/i18n/locales/vi.json', {
        title: 'New native title',
        detail: { credits: 'Native credits' },
      });
      write(repository, 'src/i18n/locales/de.json', { title: 'Übersicht' });
      git(repository, ['mv', 'shared/helper.ts', 'shared/renamed.ts']);
    });
    await syncUpstream(repository, 'release-2');
    expect(json(repository, 'src/i18n/locales/vi.json').detail.credits).toBe('Native credits');
    expect(json(repository, 'src/i18n/locales/de.json')).toEqual({ title: 'Übersicht' });
    expect(existsSync(join(repository, 'shared/helper.ts'))).toBe(false);
    expect(read(repository, 'shared/renamed.ts')).toBe('export const helper = true;\n');
    expectPluginsPreserved(repository);
    commit(repository);

    upstreamRelease(repository, 'release-3', () => {
      git(repository, ['rm', 'src/i18n/locales/de.json']);
      write(
        repository,
        'src/types/index.ts',
        "export * from './newUpstreamType';\n" + sources['src/types/index.ts']
      );
    });
    await syncUpstream(repository, 'release-3');
    expect(existsSync(join(repository, 'src/i18n/locales/de.json'))).toBe(false);
    expect(read(repository, 'src/types/index.ts')).toContain("'./newUpstreamType'");
    expect(read(repository, 'src/types/index.ts')).toContain("'./usageSafety'");
    expectPluginsPreserved(repository);
    commit(repository);

    // A publication retry must preserve the prepared source and not duplicate integrations.
    await syncUpstream(repository, 'release-3');
    expect(git(repository, ['status', '--porcelain']).stdout).toBe('');
    expect(git(repository, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], true).exitCode).not.toBe(
      0
    );
    await expect(syncUpstream(repository, 'release-1')).rejects.toThrow('not a descendant');
  }, 30000);

  test('replays the known SSR assertion exception until upstream fixes the expectation', async () => {
    const repository = await fixture();
    const path = 'tests/authFileCooldowns.test.ts';
    const brokenAssertion =
      "expect(available).toContain(i18n.t('auth_files.cooldown_reset_hint'));";

    // A new upstream release still needs the exception, while its other assertions must survive.
    const firstRelease = sources[path].replace(
      "expect(available).toContain('<button');",
      "expect(available).toContain('<button');\nexpect(available).toContain('title=');"
    );
    upstreamRelease(repository, 'cooldown-ssr-regression', () => {
      write(repository, path, firstRelease);
    });
    await syncUpstream(repository, 'cooldown-ssr-regression');
    const patched = read(repository, path);
    expect(patched).toContain(
      "test('keeps the reset action contextual and exposes pending state', () => {"
    );
    expect(patched).not.toContain(brokenAssertion);
    expect(patched).toContain("expect(available).toContain('<button');");
    expect(patched).toContain("expect(available).toContain('title=');");
    expect(patched).toContain(`expect(available).not.toContain('disabled=""');`);
    expect(patched).toContain(`expect(pending).toContain('disabled=""');`);
    commit(repository);

    // Once upstream escapes its HTML expectation, its fix and new coverage must remain active.
    const fixedExpectation = `i18n.t('auth_files.cooldown_reset_hint').replaceAll("'", '&#x27;')`;
    const fixedRelease = firstRelease
      .replace(brokenAssertion, `expect(available).toContain(${fixedExpectation});`)
      .replace(
        "expect(available).toContain('title=');",
        "expect(available).toContain('title=');\nexpect(available).toContain('Reset');"
      );
    upstreamRelease(repository, 'cooldown-ssr-fixed', () => {
      write(repository, path, fixedRelease);
    });
    await syncUpstream(repository, 'cooldown-ssr-fixed');
    expect(read(repository, path)).toBe(await formatSource(path, fixedRelease));
  });

  test('rejects a missing registered test exception before modifying the index', async () => {
    const repository = await fixture();
    const path = 'tests/authFileCooldowns.test.ts';
    write(repository, path, sources[path]);
    commit(repository);
    upstreamRelease(repository, 'cooldown-exception-not-generated', () => {
      write(repository, 'options.json', { limit: 2 });
    });
    await expectPreflightFailure(repository, 'cooldown-exception-not-generated', path);
  });

  test('migrates legacy fork documents even when upstream did not change them', async () => {
    const repository = await fixture();
    write(
      repository,
      'README.md',
      readFileSync(new URL('./fixtures/legacy-readme.txt', import.meta.url), 'utf8')
    );
    write(
      repository,
      'AGENTS.md',
      readFileSync(new URL('./fixtures/legacy-guidance.txt', import.meta.url), 'utf8')
    );
    commit(repository);
    upstreamRelease(repository, 'unchanged-docs', () =>
      write(repository, 'options.json', { limit: 2 })
    );
    await syncUpstream(repository, 'unchanged-docs');
    for (const path of ['README.md', 'AGENTS.md']) {
      expect(read(repository, path)).toBe(
        git(repository, ['show', `unchanged-docs:${path}`]).stdout
      );
    }
    expectPluginsPreserved(repository);
  });

  test('preserves the Bun-resolved lockfile on a publication retry for the same release', async () => {
    const repository = await fixture();
    upstreamRelease(repository, 'resolved-lock', () =>
      write(repository, 'options.json', { limit: 2 })
    );
    await syncUpstream(repository, 'resolved-lock');
    commit(repository);

    // Dependency resolution follows source preparation and can add plugin packages to the lock.
    write(repository, 'bun.lock', {
      lockfileVersion: 1,
      packages: {
        core: ['core@1.0.0'],
        'chart.js': ['chart.js@4.5.1'],
        'react-chartjs-2': ['react-chartjs-2@5.3.1'],
      },
    });
    commit(repository);
    const resolvedLock = read(repository, 'bun.lock');
    await syncUpstream(repository, 'resolved-lock');
    expect(read(repository, 'bun.lock')).toBe(resolvedLock);
    expect(git(repository, ['status', '--porcelain']).stdout).toBe('');
    expect(git(repository, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], true).exitCode).not.toBe(
      0
    );
    expectPluginsPreserved(repository);
  });

  for (const path of ['application.ts', 'package.json']) {
    test(`still rejects unknown changes when retrying the same release: ${path}`, async () => {
      const repository = await fixture();
      upstreamRelease(repository, 'same-release', () =>
        write(repository, 'options.json', { limit: 2 })
      );
      await syncUpstream(repository, 'same-release');
      commit(repository);
      if (path === 'package.json') {
        const local = json(repository, path);
        local.scripts.test = 'bun test --isolate';
        write(repository, path, local);
      } else {
        write(repository, path, 'export const unknownChange = true;\n');
      }
      commit(repository);
      await expectPreflightFailure(repository, 'same-release', path);
    });
  }

  test('follows upstream document deletion while preserving independent fork documentation', async () => {
    const repository = await fixture();
    upstreamRelease(repository, 'deleted-docs', () =>
      git(repository, ['rm', 'README.md', 'AGENTS.md'])
    );
    await syncUpstream(repository, 'deleted-docs');
    expect(existsSync(join(repository, 'README.md'))).toBe(false);
    expect(existsSync(join(repository, 'AGENTS.md'))).toBe(false);
    expectPluginsPreserved(repository);
  });

  test('refuses an unknown catalog edit instead of treating it as a legacy normalization', async () => {
    const repository = await fixture();
    write(repository, 'src/i18n/locales/vi.json', {
      title: 'Bảng điều khiển',
      legacyMissing: 'English fallback',
    });
    commit(repository);
    upstreamRelease(repository, 'legacy-catalog-migration', () => {
      write(repository, 'options.json', { limit: 2 });
    });
    await expectPreflightFailure(
      repository,
      'legacy-catalog-migration',
      'src/i18n/locales/vi.json'
    );
  });

  test('rejects new shared documentation edits after the one-time legacy migration', async () => {
    const repository = await fixture();
    upstreamRelease(repository, 'migrated', () => write(repository, 'options.json', { limit: 2 }));
    await syncUpstream(repository, 'migrated');
    commit(repository);
    write(repository, 'README.md', 'A new unregistered fork customization\n');
    commit(repository);
    upstreamRelease(repository, 'after-migration', () =>
      write(repository, 'options.json', { limit: 3 })
    );
    await expectPreflightFailure(repository, 'after-migration', 'README.md');
  });

  test('takes upstream chart dependency versions while adding only missing plugin dependencies', async () => {
    const repository = await fixture();
    upstreamRelease(repository, 'chart-upgrade', () => {
      write(repository, 'package.json', {
        packageManager: 'bun@1.4.3',
        scripts: { test: 'upstream test', verify: 'upstream verify' },
        dependencies: { core: '2.0.0', 'chart.js': '^5.0.0', 'react-chartjs-2': '^6.0.0' },
      });
    });
    await syncUpstream(repository, 'chart-upgrade');
    expect(json(repository, 'package.json')).toEqual(
      JSON.parse(git(repository, ['show', 'chart-upgrade:package.json']).stdout)
    );
  });

  test('keeps catalogs byte-for-byte instead of repairing missing keys or placeholders', async () => {
    const repository = await fixture();
    const english = '{"title":"Dashboard", "newKey":"{{count}} models"}\n';
    const vietnamese = '{"title":"", "newKey":"{{days}} mô hình", "native":"keep"}\n';
    const turkish = '{"native":"çeviri"}\n';
    upstreamRelease(repository, 'exact-locales', () => {
      write(repository, 'src/i18n/locales/en.json', english);
      write(repository, 'src/i18n/locales/vi.json', vietnamese);
      write(repository, 'src/i18n/locales/tr.json', turkish);
    });
    await syncUpstream(repository, 'exact-locales');
    expect(read(repository, 'src/i18n/locales/en.json')).toBe(english);
    expect(read(repository, 'src/i18n/locales/vi.json')).toBe(vietnamese);
    expect(read(repository, 'src/i18n/locales/tr.json')).toBe(turkish);
    expectPluginsPreserved(repository);
  });

  test('discards the legacy repository-link override in favor of the exact upstream page', async () => {
    const repository = await fixture();
    write(
      repository,
      'src/pages/SystemPage.tsx',
      sources['src/pages/SystemPage.tsx'].replace(
        'https://github.com/router-for-me/Cli-Proxy-API-Management-Center',
        'https://github.com/Fwindy/Cli-Proxy-API-Management-Center'
      )
    );
    commit(repository);
    upstreamRelease(repository, 'upstream-system-page', () => {
      write(repository, 'options.json', { limit: 2 });
    });
    await syncUpstream(repository, 'upstream-system-page');
    expect(read(repository, 'src/pages/SystemPage.tsx')).toBe(sources['src/pages/SystemPage.tsx']);
  });

  test('refuses unrepresented integration edits before modifying the index', async () => {
    const repository = await fixture();
    write(
      repository,
      'src/router/MainRoutes.tsx',
      read(repository, 'src/router/MainRoutes.tsx') + '\n// An additional fork change\n'
    );
    commit(repository);
    upstreamRelease(repository, 'unknown-integration', () =>
      write(repository, 'options.json', { limit: 2 })
    );
    await expectPreflightFailure(repository, 'unknown-integration', 'refusing to overwrite');
  });

  test('reports an upstream integration contract change before modifying the index', async () => {
    const repository = await fixture();
    upstreamRelease(repository, 'changed-contract', () => {
      write(
        repository,
        'src/router/MainRoutes.tsx',
        sources['src/router/MainRoutes.tsx'].replaceAll('createMainRoutes', 'renamedRouteBuilder')
      );
    });
    await expectPreflightFailure(repository, 'changed-contract', 'variable createMainRoutes');
  });

  for (const [path, content] of [
    ['application.ts', 'export const value = "fork";\n'],
    ['options.json', '{"limit":2,"forkFlag":true}\n'],
    ['src/features/example.ts', 'export const undeclaredExtension = true;\n'],
  ]) {
    test(`rejects unregistered fork changes before replacing upstream: ${path}`, async () => {
      const repository = await fixture();
      write(repository, path, content);
      commit(repository);
      upstreamRelease(repository, 'unknown-fork-change', () =>
        write(repository, 'README.md', 'New upstream docs\n')
      );
      await expectPreflightFailure(repository, 'unknown-fork-change', path);
    });
  }

  test('rejects an unregistered deletion before replacing upstream', async () => {
    const repository = await fixture();
    git(repository, ['rm', 'redundant.json']);
    commit(repository);
    upstreamRelease(repository, 'unknown-fork-deletion', () =>
      write(repository, 'options.json', { limit: 2 })
    );
    await expectPreflightFailure(repository, 'unknown-fork-deletion', 'redundant.json');
  });

  test('rejects undeclared dependency customization instead of silently dropping it', async () => {
    const repository = await fixture();
    const local = json(repository, 'package.json');
    local.dependencies['unregistered-library'] = '1.0.0';
    write(repository, 'package.json', local);
    commit(repository);
    upstreamRelease(repository, 'unknown-dependency', () =>
      write(repository, 'options.json', { limit: 2 })
    );
    await expectPreflightFailure(repository, 'unknown-dependency', 'package.json');
  });

  test('rejects a dirty checkout without disturbing uncommitted changes', async () => {
    const repository = await fixture();
    upstreamRelease(repository, 'clean-required', () =>
      write(repository, 'options.json', { limit: 2 })
    );
    write(repository, 'application.ts', 'uncommitted work\n');
    const before = git(repository, ['status', '--porcelain']).stdout;
    await expect(syncUpstream(repository, 'clean-required')).rejects.toThrow('clean checkout');
    expect(read(repository, 'application.ts')).toBe('uncommitted work\n');
    expect(git(repository, ['status', '--porcelain']).stdout).toBe(before);
  });

  for (const path of [
    'src/fork/sentinel.ts',
    '.github/workflows/manual-upstream-release.yml',
    '.github/workflows/upstream-release.yml',
    'src/fork/newUpstreamModule.ts',
    'src/features/notifications/UsageNotificationsPage.tsx',
    'src/features/notifications/newUpstreamModule.ts',
    'src/features/safety/newUpstreamModule.ts',
    'src/components/monitor/newUpstreamModule.ts',
    'src/i18n/forkTranslations.ts',
    'src/i18n/notificationTranslations.ts',
    'src/services/api/notifications.ts',
    'src/services/api/usagePluginClient.ts',
    'src/services/api/usage.ts',
    'src/services/api/notifications.ts/child.ts',
    'tests/fork/upstreamOwned.test.ts',
    'FORK.md',
  ]) {
    test(`rejects upstream plugin namespace occupation: ${path}`, async () => {
      const repository = await fixture();
      const source = existsSync(join(repository, path))
        ? read(repository, path)
        : 'export const upstreamOnly = true;\n';
      upstreamRelease(repository, 'namespace-collision', () => write(repository, path, source));
      await expectPreflightFailure(repository, 'namespace-collision', path);
    });
  }

  for (const path of ['src/features', 'src/features/notifications', 'src/fork', 'tests/fork']) {
    test(`rejects an upstream file obstructing a reserved directory: ${path}`, async () => {
      const repository = await fixture();
      upstreamRelease(repository, 'directory-obstruction', () =>
        write(repository, path, 'upstream file\n')
      );
      await expectPreflightFailure(repository, 'directory-obstruction', path);
      expectPluginsPreserved(repository);
    });
  }

  test('allows nearby upstream namespaces while preserving plugin files', async () => {
    const repository = await fixture();
    const additions = [
      'src/features/notifications-extra/UpstreamPage.tsx',
      'src/i18n/notificationTranslationsExtra.ts',
      'src/services/api/notificationsV2.ts',
    ];
    upstreamRelease(repository, 'nearby-namespaces', () => {
      for (const path of additions) write(repository, path, 'export const upstream = true;\n');
    });
    await syncUpstream(repository, 'nearby-namespaces');
    for (const path of additions) {
      expect(read(repository, path)).toBe('export const upstream = true;\n');
    }
    expectPluginsPreserved(repository);
  });
});
