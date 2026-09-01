export interface SafetyKeyStatus {
  api_key: string;
  total_trigger_count: number;
  window_trigger_count: number;
  total_limit_count: number;
  manual_disabled: boolean;
  blocked: boolean;
  blocked_until: number;
}

export interface SafetyKeysResponse {
  keys: SafetyKeyStatus[];
}

export type SafetyHistoryStatus = 'not_limited' | 'active' | 'expired' | 'manual_released';

export interface SafetyHistoryItem {
  api_key: string;
  occurred_at: number;
  usage_record_id: string;
  blocked_until: number;
  manual_released_at: number;
  provider: string;
  model: string;
  failure_status_code: number;
  failure_body: unknown;
  status: SafetyHistoryStatus;
}

export interface SafetyHistoryResponse {
  history: SafetyHistoryItem[];
}

export interface SafetyHistoryQuery {
  api_key: string;
  blocked_only?: boolean;
  before_time?: number;
  before_id?: string;
  limit?: number;
}

export interface SafetyReleaseResult {
  released: string[];
  not_blocked: string[];
}

export interface SafetyDisableResult {
  disabled: string[];
  already_disabled: string[];
  missing: string[];
}

export interface SafetyEnableResult {
  enabled: string[];
  already_enabled: string[];
  missing: string[];
}
