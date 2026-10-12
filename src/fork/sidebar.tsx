/** Fork sidebar entries and plugin availability, independent of upstream layout markup. */
import { IconShield, IconSidebarLogs } from '@/components/ui/icons';
import {
  IconSidebarCredentialCenter,
  IconSidebarMonitoring,
} from '@/components/layout/forkSidebarIcons';
import type { SidebarNavGroup } from '@/components/layout/MainLayout';
import type { PluginListEntry } from '@/types';
import { forkPagePaths, forkSidebarGroups } from './navigation';
import { USAGE_PLUGIN_ID } from './usagePlugin';

/** Only an enabled, registered usage plugin exposes safety and notification navigation. */
export function isUsagePluginAvailable(plugins: PluginListEntry[]): boolean {
  return plugins.some(
    (plugin) => plugin.id === USAGE_PLUGIN_ID && plugin.registered && plugin.effectiveEnabled
  );
}

/** Extend existing groups without modifying upstream entries or their order. */
export function extendForkSidebar(
  groups: SidebarNavGroup[],
  usagePluginAvailable: boolean
): SidebarNavGroup[] {
  const additions: Record<string, SidebarNavGroup['items']> = {
    [forkSidebarGroups.observe]: [
      {
        path: forkPagePaths.monitoring,
        labelKey: 'nav.monitoring_center',
        metaKey: 'nav_meta.monitoring_center',
        icon: <IconSidebarMonitoring size={18} />,
      },
      ...(usagePluginAvailable
        ? [
            {
              path: forkPagePaths.safety,
              labelKey: 'nav.safety_center',
              metaKey: 'nav_meta.safety_center',
              icon: <IconShield size={18} />,
            },
            {
              path: forkPagePaths.notifications,
              labelKey: 'nav.usage_notifications',
              metaKey: 'usage_notifications.description',
              icon: <IconSidebarLogs size={18} />,
            },
          ]
        : []),
    ],
    [forkSidebarGroups.control]: [
      {
        path: forkPagePaths.credentials,
        labelKey: 'nav.credential_center',
        metaKey: 'nav_meta.credential_center',
        icon: <IconSidebarCredentialCenter size={18} />,
      },
    ],
  };

  // Group removal changes the extension contract; never silently hide fork pages.
  for (const id of Object.keys(additions)) {
    if (!groups.some((group) => group.id === id)) {
      throw new Error(`Upstream sidebar group ${id} is missing`);
    }
  }
  return groups.map((group) => {
    const items = group.items.filter(
      (item) => item.kind === 'drawer' || item.path !== '/quick-start'
    );
    const forkItems = additions[group.id] ?? [];
    const paths = new Set(
      items.flatMap((item) =>
        item.kind === 'drawer' ? item.children.map((child) => child.path) : [item.path]
      )
    );
    for (const item of forkItems) {
      if (item.kind !== 'drawer' && paths.has(item.path)) {
        throw new Error(`Upstream and fork both register sidebar path ${item.path}`);
      }
    }
    // Preserve the established positions: after quota and before control entries.
    const insertion =
      group.id === forkSidebarGroups.observe
        ? items.findIndex((item) => item.kind !== 'drawer' && item.path === '/quota') + 1
        : 0;
    return {
      ...group,
      items: [...items.slice(0, insertion), ...forkItems, ...items.slice(insertion)],
    };
  });
}
