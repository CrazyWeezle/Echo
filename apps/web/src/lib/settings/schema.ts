// TS-first schemas for settings; can be replaced with Zod easily.

export type AccountSettings = {
  email: string;
  twoFactorEnabled: boolean;
};

export type ProfileSettings = {
  displayName: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bio?: string;
};

export type AppearanceSettings = {
  theme: "system" | "light" | "dark";
  accent: "emerald" | "blue" | "purple" | "rose" | "amber" | "indigo" | "cyan" | "orange";
  density: "compact" | "comfortable";
};

export type NotificationSettings = {
  globalMute: boolean;
  perChannelDefault: "all" | "mentions" | "none";
  desktop: boolean;
  mobile: boolean;
  digest: "off" | "daily" | "weekly";
};

export type PrivacySettings = {
  profileVisibility: "everyone" | "friends" | "private";
  dmPermissions: "everyone" | "friends" | "none";
  readReceipts: boolean;
};

export type DevicesSettings = Record<string, unknown>; // server-driven
export type IntegrationsSettings = {
  githubConnected?: boolean;
  notionConnected?: boolean;
};

export type AdvancedSettings = {
  developerLogs: boolean;
};

export type SettingsModel = {
  account: AccountSettings;
  profile: ProfileSettings;
  appearance: AppearanceSettings;
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  devices: DevicesSettings;
  integrations: IntegrationsSettings;
  advanced: AdvancedSettings;
};

export const defaultSettings: SettingsModel = {
  account: { email: "", twoFactorEnabled: false },
  profile: { displayName: "", avatarUrl: null, bannerUrl: null, bio: "" },
  appearance: { theme: "system", accent: "emerald", density: "comfortable" },
  notifications: { globalMute: false, perChannelDefault: "all", desktop: true, mobile: true, digest: "off" },
  privacy: { profileVisibility: "everyone", dmPermissions: "everyone", readReceipts: true },
  devices: {},
  integrations: { githubConnected: false, notionConnected: false },
  advanced: { developerLogs: false },
};

