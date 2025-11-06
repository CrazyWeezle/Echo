import { api } from '../../lib/api';
import { defaultSettings, SettingsModel } from './schema';

export async function getMe(token: string) {
  return api.getAuth('/users/me', token);
}

export async function updateMe(partial: any, token: string) {
  return api.patchAuth('/users/me', partial, token);
}

export async function changePassword(oldPassword: string, newPassword: string, token: string) {
  return api.postAuth('/users/password', { oldPassword, newPassword }, token);
}

export async function disableAccount(token: string) {
  return api.postAuth('/users/disable', {}, token);
}

export async function deleteAccount(token: string) {
  return api.postAuth('/users/delete', {}, token);
}

// ---- Client-side settings stub ----
// Several settings sections write via patchMySettingsSection().
// Backend endpoints are not implemented yet, so persist locally
// to keep the UI functional and the build happy.

type SectionId = 'account' | 'profile' | 'appearance' | 'notifications' | 'privacy' | 'devices' | 'integrations' | 'advanced';

function readLocalSettings(): Record<string, any> {
  try {
    const raw = localStorage.getItem('settings');
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function writeLocalSettings(obj: Record<string, any>) {
  try { localStorage.setItem('settings', JSON.stringify(obj)); } catch {}
}

export async function patchMySettingsSection(section: SectionId, patch: Record<string, any>): Promise<void> {
  try {
    const all = readLocalSettings();
    const cur = all[section] && typeof all[section] === 'object' ? all[section] : {};
    all[section] = { ...cur, ...patch };
    writeLocalSettings(all);
  } catch {
    // ignore — best-effort local persistence
  }
}

export async function fetchMySettings(): Promise<SettingsModel> {
  // Merge any locally saved overrides on top of defaults
  const local = readLocalSettings();
  const merged: SettingsModel = {
    ...defaultSettings,
    account: { ...defaultSettings.account, ...(local.account || {}) },
    profile: { ...defaultSettings.profile, ...(local.profile || {}) },
    appearance: { ...defaultSettings.appearance, ...(local.appearance || {}) },
    notifications: { ...defaultSettings.notifications, ...(local.notifications || {}) },
    privacy: { ...defaultSettings.privacy, ...(local.privacy || {}) },
    devices: { ...defaultSettings.devices, ...(local.devices || {}) },
    integrations: { ...defaultSettings.integrations, ...(local.integrations || {}) },
    advanced: { ...defaultSettings.advanced, ...(local.advanced || {}) },
  };
  return merged;
}
