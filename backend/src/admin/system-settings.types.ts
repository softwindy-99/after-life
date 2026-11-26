export type PushProxySource = 'WEB_PUSH_PROXY' | 'HTTPS_PROXY' | 'https_proxy' | null;

export interface SystemSettingsStatus {
  pushProxy: string;
  pushProxyConfigured: boolean;
  pushProxyValid: boolean;
  pushProxyHasCredentials: boolean;
  pushProxySource: PushProxySource;
}

export interface UpdateSystemSettings {
  pushProxy?: string | null;
}
