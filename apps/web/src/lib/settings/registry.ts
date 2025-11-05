// Registry of settings sections used for sidebar + command palette

export type SectionId =
  | "account"
  | "profile"
  | "appearance"
  | "notifications"
  | "privacy"
  | "devices"
  | "integrations"
  | "advanced";

export type SectionItem = {
  id: SectionId;
  label: string;
  description?: string;
  keywords?: string[];
  icon: string; // icon key (local svg map)
};

export const SETTINGS_SECTIONS: SectionItem[] = [
  { id: "account", label: "Account", icon: "user", keywords: ["email","password","2fa","security"] },
  { id: "profile", label: "Profile", icon: "id", keywords: ["name","avatar","bio","banner"] },
  { id: "appearance", label: "Appearance", icon: "paint", keywords: ["theme","dark","accent","density"] },
  { id: "notifications", label: "Notifications", icon: "bell", keywords: ["mute","digest","desktop","mobile"] },
  { id: "privacy", label: "Privacy & Security", icon: "shield", keywords: ["visibility","dm","read receipts"] },
  { id: "devices", label: "Devices & Sessions", icon: "laptop", keywords: ["sessions","revoke","sign out"] },
  { id: "integrations", label: "Integrations", icon: "plug", keywords: ["github","notion","connect"] },
  { id: "advanced", label: "Advanced", icon: "wrench", keywords: ["export","cache","developer"] },
];

export function findSection(id: string): SectionItem | undefined {
  return SETTINGS_SECTIONS.find(s => s.id === id);
}

