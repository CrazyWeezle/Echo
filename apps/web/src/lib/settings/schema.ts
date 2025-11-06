// Settings model used by the Settings UI. These are client-side preferences
// until server endpoints are implemented.

export type SettingsModel = {
  account: {
    email: string;
    twoFactorEnabled: boolean;
  };
  profile: {
    // Reserved for future profile settings in UI; most profile fields
    // are edited directly via /users/me today
  };
  appearance: {
    theme: 'system' | 'light' | 'dark';
    accent: 'emerald' | 'blue' | 'purple' | 'rose' | 'amber' | 'indigo' | 'cyan' | 'orange';
    density: 'compact' | 'comfortable';
  };
  notifications: {
    globalMute: boolean;
    perChannelDefault: 'all' | 'mentions' | 'none';
    desktop: boolean;
    mobile: boolean;
    digest: 'off' | 'daily' | 'weekly';
  };
  privacy: {
    profileVisibility: 'everyone' | 'friends' | 'private';
    dmPermissions: 'everyone' | 'friends' | 'none';
    readReceipts: boolean;
  };
  devices: {
    // Placeholder for device/session UI
  };
  integrations: {
    // Placeholder for integration prefs
  };
  advanced: {
    developerLogs: boolean;
  };
};

export const defaultSettings: SettingsModel = {
  account: { email: '', twoFactorEnabled: false },
  profile: {},
  appearance: { theme: 'system', accent: 'emerald', density: 'comfortable' },
  notifications: { globalMute: false, perChannelDefault: 'mentions', desktop: true, mobile: true, digest: 'off' },
  privacy: { profileVisibility: 'everyone', dmPermissions: 'friends', readReceipts: true },
  devices: {},
  integrations: {},
  advanced: { developerLogs: false },
};
