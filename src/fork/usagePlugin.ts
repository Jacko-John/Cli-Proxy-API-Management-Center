/** The independent plugin identity shared by navigation and API transport. */
export const USAGE_PLUGIN_ID = 'jacko-usage-statistics';

/** Plugin routes keep the host-declared mount, independently of the core management API. */
export const USAGE_PLUGIN_API_BASE = `/v0/management/plugins/${USAGE_PLUGIN_ID}`;
