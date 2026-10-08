/** Fork routes are registered separately so the upstream route table can evolve. */
import { Navigate, type RouteObject } from 'react-router-dom';
import { SafetyCenterPage } from '@/features/safety/SafetyCenterPage';
import { UsageNotificationsPage } from '@/features/notifications/UsageNotificationsPage';
import { MonitoringCenterPage } from '@/pages/MonitoringCenterPage';
import { CredentialCenterPage } from '@/pages/CredentialCenterPage';
import { forkPagePaths } from './navigation';

/** Keep upstream routes and append the fork pages with their existing capability gates. */
export function extendForkRoutes(routes: RouteObject[], supportsPlugin: boolean): RouteObject[] {
  const additions: RouteObject[] = [
    { path: forkPagePaths.monitoring, element: <MonitoringCenterPage /> },
    { path: forkPagePaths.credentials, element: <CredentialCenterPage /> },
    {
      path: forkPagePaths.safety,
      element: supportsPlugin ? <SafetyCenterPage /> : <Navigate to="/" replace />,
    },
    ...(supportsPlugin
      ? [{ path: forkPagePaths.notifications, element: <UsageNotificationsPage /> }]
      : []),
  ];
  const upstreamPaths = new Set(routes.map((route) => route.path));
  for (const route of additions) {
    if (upstreamPaths.has(route.path)) {
      throw new Error(`Upstream and fork both register route ${route.path}`);
    }
  }
  return [...routes, ...additions];
}
