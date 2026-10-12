import { describe, expect, test } from 'bun:test';
import { matchRoutes, type RouteObject } from 'react-router-dom';
import type { SidebarNavGroup } from '../src/components/layout/MainLayout';
import type { PluginListEntry } from '../src/types';
import { extendForkRoutes } from '../src/fork/routes';
import { extendForkSidebar, isUsagePluginAvailable } from '../src/fork/sidebar';

describe('fork navigation extensions', () => {
  test('keeps upstream routes and gates plugin pages', () => {
    const upstream: RouteObject[] = [
      { path: '/new-upstream-page', element: 'upstream' },
      { path: '*' },
    ];
    const routes = extendForkRoutes(upstream, true);
    expect(routes.slice(0, upstream.length)).toEqual(upstream);
    expect(routes.map((route) => route.path)).toContain('/usage-notifications');
    expect(routes.map((route) => route.path)).toContain('/credential-center');
    expect(matchRoutes(routes, '/monitor')?.at(-1)?.route.path).toBe('/monitor');
    expect(matchRoutes(routes, '/new-upstream-page')?.at(-1)?.route.path).toBe(
      '/new-upstream-page'
    );
    expect(
      extendForkRoutes(upstream, false).some((route) => route.path === '/usage-notifications')
    ).toBe(false);
    expect(upstream).toHaveLength(2);
    expect(() => extendForkRoutes([{ path: '/monitor' }], true)).toThrow('both register');
  });

  test('keeps upstream groups and entries, hides quick start, and preserves fork ordering', () => {
    const groups: SidebarNavGroup[] = [
      {
        id: 'operate',
        labelKey: 'operate',
        items: [
          { path: '/quick-start', icon: null },
          { path: '/new-upstream-page', icon: null },
        ],
      },
      {
        id: 'observe',
        labelKey: 'observe',
        items: [
          { path: '/quota', icon: null },
          { path: '/new-metric', icon: null },
          { path: '/logs', icon: null },
        ],
      },
      { id: 'control', labelKey: 'control', items: [{ path: '/config', icon: null }] },
    ];
    const original = groups.map((group) => ({ ...group, items: [...group.items] }));
    const paths = (value: SidebarNavGroup) =>
      value.items.map((item) => (item.kind === 'drawer' ? item.id : item.path));
    const extended = extendForkSidebar(groups, true);
    expect(paths(extended[0])).toEqual(['/new-upstream-page']);
    expect(paths(extended[1])).toEqual([
      '/quota',
      '/monitor',
      '/safety',
      '/usage-notifications',
      '/new-metric',
      '/logs',
    ]);
    expect(paths(extended[2])).toEqual(['/credential-center', '/config']);
    expect(paths(extendForkSidebar(groups, false)[1])).toEqual([
      '/quota',
      '/monitor',
      '/new-metric',
      '/logs',
    ]);
    expect(groups).toEqual(original);
    expect(() => extendForkSidebar([], true)).toThrow('group observe is missing');
  });

  test('only exposes the usage plugin when registered and enabled', () => {
    const plugin = {
      id: 'jacko-usage-statistics',
      registered: true,
      effectiveEnabled: true,
    } as PluginListEntry;
    expect(isUsagePluginAvailable([plugin])).toBe(true);
    expect(isUsagePluginAvailable([{ ...plugin, registered: false }])).toBe(false);
    expect(isUsagePluginAvailable([{ ...plugin, effectiveEnabled: false }])).toBe(false);
    expect(isUsagePluginAvailable([{ ...plugin, id: 'usage-statistics' }])).toBe(false);
    expect(isUsagePluginAvailable([{ ...plugin, id: 'another-plugin' }])).toBe(false);
  });
});
