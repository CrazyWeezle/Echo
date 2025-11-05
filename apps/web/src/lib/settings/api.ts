// Lightweight helpers for settings API using existing api wrapper
import { api } from "../../lib/api";

export type SettingsPayload = Record<string, unknown>;

function getToken(): string | null {
  try { return localStorage.getItem("token"); } catch { return null; }
}

export async function fetchMySettings(): Promise<any> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  return api.getAuth("/settings/me", token);
}

export async function patchMySettingsSection<T extends SettingsPayload>(section: string, body: T): Promise<any> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  return api.patchAuth(`/settings/me/${encodeURIComponent(section)}`, body, token);
}

