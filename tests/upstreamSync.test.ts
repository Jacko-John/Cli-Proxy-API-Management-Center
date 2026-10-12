import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { syncUpstream } from '../scripts/sync-upstream';
import { git } from '../scripts/upstream/git';
import { mergeJson, missing } from '../scripts/upstream/json-merge';
import { patchUpstreamSource, sourcePatches } from '../scripts/upstream/source-patches';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function write(repository: string, path: string, content: string | object): void {
  mkdirSync(dirname(join(repository, path)), { recursive: true });
  writeFileSync(
    join(repository, path),
    typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n'
  );
}

const read = (repository: string, path: string) => readFileSync(join(repository, path), 'utf8');
const json = (repository: string, path: string) => JSON.parse(read(repository, path));
const commit = (repository: string) => {
  git(repository, ['add', '.']);
  git(repository, ['commit', '-qm', 'Sync fixture']);
};

// Independent upstream fixtures deliberately keep all integration surfaces, not just i18n.
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
};

// Independent fork payloads exercise preservation without deriving fixtures from the ownership list.
const notificationSources: Record<string, string> = {
  'src/features/notifications/UsageNotificationsPage.tsx': 'export const page = "notifications";\n',
  'src/features/notifications/NotificationSMTPSettings.tsx':
    'export const accounts = "multiple";\n',
  'src/features/notifications/UsageNotificationsPage.module.scss': '.page { display: grid; }\n',
  'src/i18n/forkTranslations.ts': 'export const overlay = true;\n',
  'src/i18n/notificationTranslations.ts': 'export const senderLabel = "Sender";\n',
  'src/services/api/notifications.ts': 'export const settings = "smtp_profiles";\n',
  'src/services/api/usagePluginClient.ts': 'export const transport = "plugin";\n',
};

/** Compare opaque feature content after a merge, independently of the source patch generator. */
function expectNotificationsPreserved(repository: string): void {
  for (const [path, source] of Object.entries(notificationSources))
    expect(read(repository, path)).toBe(source);
}

/** Make real merge histories in temporary repositories with no dependence on checkout depth. */
async function fixture(): Promise<string> {
  const repository = mkdtempSync(join(tmpdir(), 'cpa-upstream-sync-'));
  directories.push(repository);
  git(repository, ['init', '-q', '--initial-branch=main']);
  git(repository, ['config', 'user.name', 'Sync fixture']);
  git(repository, ['config', 'user.email', 'sync-fixture@example.invalid']);
  git(repository, ['config', 'commit.gpgsign', 'false']);
  git(repository, ['config', 'core.hooksPath', join(repository, '.git/disabled-hooks')]);
  for (const [path, source] of Object.entries(sources)) write(repository, path, source);
  write(repository, 'src/i18n/locales/en.json', { title: 'Dashboard' });
  write(repository, 'src/i18n/locales/vi.json', { title: 'Bảng điều khiển' });
  write(repository, 'package.json', {
    scripts: { test: 'bun test' },
    dependencies: { core: '1.0.0' },
  });
  write(repository, 'bun.lock', { lockfileVersion: 1, packages: { core: ['core@1.0.0'] } });
  write(repository, 'README.md', 'Upstream documentation\n');
  write(repository, 'application.ts', 'export const value = "base";\n');
  write(repository, 'shared/helper.ts', 'export const helper = true;\n');
  write(repository, 'options.json', { limit: 1, inherited: true });
  write(repository, 'redundant.json', { enabled: false });
  commit(repository);
  const baseline = git(repository, ['rev-parse', 'HEAD']).stdout.trim();
  git(repository, ['branch', 'upstream']);

  write(repository, '.github/upstream-sync.json', {
    upstreamTag: 'base',
    upstreamCommit: baseline,
  });
  for (const path of Object.keys(sourcePatches))
    write(repository, path, await patchUpstreamSource(path, sources[path]));
  write(repository, 'src/fork/sentinel.ts', 'export const feature = "preserve me";\n');
  for (const [path, source] of Object.entries(notificationSources)) write(repository, path, source);
  write(repository, 'README.md', 'Fork documentation\n');
  write(repository, 'options.json', { limit: 1, inherited: true, forkFlag: true });
  git(repository, ['rm', 'redundant.json']);
  write(repository, 'package.json', {
    scripts: { test: 'bun test --isolate' },
    dependencies: { core: '1.0.0', 'fork-lib': '1.0.0' },
  });
  write(repository, 'bun.lock', {
    lockfileVersion: 1,
    packages: { core: ['core@1.0.0'], 'fork-lib': ['fork-lib@1.0.0'] },
  });
  commit(repository);
  return repository;
}

function upstreamRelease(repository: string, tag: string, update: () => void): void {
  git(repository, ['checkout', '-q', 'upstream']);
  update();
  commit(repository);
  git(repository, ['tag', tag]);
  git(repository, ['checkout', '-q', 'main']);
}

describe('structural JSON three-way merge', () => {
  test('combines independent additions, nested updates and deletions without mutating inputs', () => {
    const base = { dependencies: { core: '1', removed: '1' }, flags: { upstream: false } };
    const ours = {
      dependencies: { core: '1', removed: '1', fork: '1' },
      flags: { upstream: false },
    };
    const theirs = { dependencies: { core: '2' }, flags: { upstream: true }, newKey: 'new' };
    const original = structuredClone(ours);
    expect(mergeJson(base, ours, theirs)).toEqual({
      dependencies: { core: '2', fork: '1' },
      flags: { upstream: true },
      newKey: 'new',
    });
    expect(ours).toEqual(original);
    expect(mergeJson(missing, { left: 1 }, { right: 2 })).toEqual({ left: 1, right: 2 });
    expect(mergeJson({ key: 1 }, missing, { key: 1 })).toBe(missing);
  });

  test('rejects conflicting values, delete/edit conflicts and unordered array guesses', () => {
    expect(() => mergeJson({ key: 1 }, { key: 2 }, { key: 3 })).toThrow('$.key');
    expect(() => mergeJson({ key: 1 }, {}, { key: 2 })).toThrow('$.key');
    expect(() => mergeJson([1], [1, 2], [1, 3])).toThrow('$');
  });
});

describe('fork source synchronization', () => {
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

  test('preserves extensions through consecutive upstream edits, additions, renames and deletions', async () => {
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
          .replace('supportsPlugin', 'available')
          .replace('...(supportsPlugin', '...(available')
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
      write(repository, 'src/i18n/locales/en.json', {
        title: 'Dashboard',
        detail: { credits: 'Compute credits' },
      });
      write(repository, 'package.json', {
        scripts: { test: 'bun test', lint: 'upstream lint' },
        dependencies: { core: '2.0.0', newDependency: '1.0.0' },
      });
      write(repository, 'bun.lock', {
        lockfileVersion: 1,
        packages: { core: ['core@2.0.0'], newDependency: ['newDependency@1.0.0'] },
      });
      write(repository, 'README.md', 'Changed upstream documentation\n');
      write(repository, 'options.json', { limit: 2, inherited: true, upstreamFlag: true });
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
      scripts: { test: 'bun test --isolate', lint: 'upstream lint' },
      dependencies: { core: '2.0.0', newDependency: '1.0.0', 'fork-lib': '1.0.0' },
    });
    expect(json(repository, 'bun.lock').packages).toEqual({
      core: ['core@2.0.0'],
      newDependency: ['newDependency@1.0.0'],
      'fork-lib': ['fork-lib@1.0.0'],
    });
    expect(json(repository, 'src/i18n/locales/vi.json').detail.credits).toBe('Compute credits');
    expect(read(repository, 'README.md')).toBe('Fork documentation\n');
    expect(json(repository, 'options.json')).toEqual({
      limit: 2,
      inherited: true,
      upstreamFlag: true,
      forkFlag: true,
    });
    expect(existsSync(join(repository, 'redundant.json'))).toBe(false);
    expectNotificationsPreserved(repository);
    commit(repository);

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
    expect(json(repository, 'src/i18n/locales/de.json').detail.credits).toBe('Compute credits');
    expect(existsSync(join(repository, 'shared/helper.ts'))).toBe(false);
    expect(existsSync(join(repository, 'shared/renamed.ts'))).toBe(true);
    expectNotificationsPreserved(repository);
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
    expect(read(repository, 'src/fork/sentinel.ts')).toBe(
      'export const feature = "preserve me";\n'
    );
    expect(git(repository, ['diff', '--name-only', '--diff-filter=U']).stdout).toBe('');
    expectNotificationsPreserved(repository);
    commit(repository);

    // Simulate a release creation failure after source push: rerunning must leave source unchanged.
    await syncUpstream(repository, 'release-3');
    expect(git(repository, ['status', '--porcelain']).stdout).toBe('');
    expect(git(repository, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], true).exitCode).not.toBe(
      0
    );
    await expect(syncUpstream(repository, 'release-1')).rejects.toThrow('not a descendant');
  }, 30000);

  test('refuses unrepresented fork edits before modifying the index', async () => {
    const repository = await fixture();
    write(
      repository,
      'src/router/MainRoutes.tsx',
      read(repository, 'src/router/MainRoutes.tsx') + '\n// An additional fork change\n'
    );
    commit(repository);
    upstreamRelease(repository, 'next', () =>
      write(repository, 'application.ts', 'upstream change\n')
    );
    const before = git(repository, ['rev-parse', 'HEAD']).stdout;
    await expect(syncUpstream(repository, 'next')).rejects.toThrow('refusing to overwrite');
    expect(git(repository, ['rev-parse', 'HEAD']).stdout).toBe(before);
    expect(git(repository, ['status', '--porcelain']).stdout).toBe('');
  });

  test('reports an upstream integration contract change before starting a merge', async () => {
    const repository = await fixture();
    upstreamRelease(repository, 'changed-contract', () =>
      write(
        repository,
        'src/router/MainRoutes.tsx',
        sources['src/router/MainRoutes.tsx'].replaceAll('createMainRoutes', 'renamedRouteBuilder')
      )
    );
    await expect(syncUpstream(repository, 'changed-contract')).rejects.toThrow(
      'variable createMainRoutes'
    );
    expect(git(repository, ['status', '--porcelain']).stdout).toBe('');
  });

  test('retains real business conflicts and rejects a dirty checkout', async () => {
    const repository = await fixture();
    write(repository, 'application.ts', 'export const value = "fork";\n');
    commit(repository);
    upstreamRelease(repository, 'business-conflict', () =>
      write(repository, 'application.ts', 'export const value = "upstream";\n')
    );
    await expect(syncUpstream(repository, 'business-conflict')).rejects.toThrow('application.ts');
    expect(git(repository, ['diff', '--name-only', '--diff-filter=U']).stdout.trim()).toBe(
      'application.ts'
    );
    await expect(syncUpstream(repository, 'business-conflict')).rejects.toThrow('clean checkout');
  });

  test('keeps conflicting JSON values available for review instead of choosing a side', async () => {
    const repository = await fixture();
    write(repository, 'options.json', { limit: 2, inherited: true });
    commit(repository);
    upstreamRelease(repository, 'json-conflict', () =>
      write(repository, 'options.json', { limit: 3, inherited: true })
    );
    await expect(syncUpstream(repository, 'json-conflict')).rejects.toThrow('options.json.limit');
    expect(git(repository, ['diff', '--name-only', '--diff-filter=U']).stdout).toContain(
      'options.json'
    );
  });

  for (const path of [
    'src/fork/sentinel.ts',
    'src/fork/newUpstreamModule.ts',
    'src/features/notifications/UsageNotificationsPage.tsx',
    'src/features/notifications/newUpstreamModule.ts',
    'src/i18n/forkTranslations.ts',
    'src/i18n/notificationTranslations.ts',
    'src/services/api/notifications.ts',
    'src/services/api/usagePluginClient.ts',
    'src/services/api/notifications.ts/child.ts',
  ]) {
    test(`rejects namespace occupation before merging: ${path}`, async () => {
      const repository = await fixture();
      const before = git(repository, ['rev-parse', 'HEAD']).stdout;
      const state = read(repository, '.github/upstream-sync.json');
      // Identical additions and upstream-only child files need not create a textual Git conflict.
      const source = existsSync(join(repository, path))
        ? read(repository, path)
        : 'export const upstreamOnly = true;\n';
      upstreamRelease(repository, 'namespace-collision', () => write(repository, path, source));

      await expect(syncUpstream(repository, 'namespace-collision')).rejects.toThrow(
        'upstream occupies fork extension paths'
      );
      expect(git(repository, ['status', '--porcelain']).stdout).toBe('');
      expect(git(repository, ['rev-parse', 'HEAD']).stdout).toBe(before);
      expect(
        git(repository, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], true).exitCode
      ).not.toBe(0);
      expect(read(repository, '.github/upstream-sync.json')).toBe(state);
    });
  }

  for (const path of ['src/features', 'src/features/notifications']) {
    test(`rejects a file obstructing a reserved directory: ${path}`, async () => {
      const repository = await fixture();
      upstreamRelease(repository, 'directory-obstruction', () =>
        write(repository, path, 'upstream file in place of a directory\n')
      );
      await expect(syncUpstream(repository, 'directory-obstruction')).rejects.toThrow(
        'upstream occupies fork extension paths'
      );
      expect(git(repository, ['status', '--porcelain']).stdout).toBe('');
      expectNotificationsPreserved(repository);
    });
  }

  test('allows nearby upstream namespaces and preserves notification files', async () => {
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
    for (const path of additions)
      expect(read(repository, path)).toBe('export const upstream = true;\n');
    expectNotificationsPreserved(repository);
  });

  test('does not overwrite colliding feature files independently added by both sides', async () => {
    const repository = await fixture();
    write(repository, 'src/features/example.ts', 'fork feature\n');
    commit(repository);
    upstreamRelease(repository, 'feature-collision', () =>
      write(repository, 'src/features/example.ts', 'upstream feature\n')
    );
    await expect(syncUpstream(repository, 'feature-collision')).rejects.toThrow(
      'src/features/example.ts'
    );
  });
});
