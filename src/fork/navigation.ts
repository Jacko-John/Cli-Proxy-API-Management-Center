/** Shared navigation contracts used by the UI extensions and source patch validation. */
export const forkPagePaths = {
  monitoring: '/monitor',
  credentials: '/credential-center',
  safety: '/safety',
  notifications: '/usage-notifications',
} as const;

export const forkSidebarGroups = {
  observe: 'observe',
  control: 'control',
} as const;
