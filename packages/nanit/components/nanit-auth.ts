/**
 * Shared Nanit auth utilities.
 *
 * Constants, types, IPC fetch helper, and token refresh logic
 * used by all Nanit components (drawer, widget, floating widget, entity drawer).
 */

import { logger } from '@drift/plugin-api';

// ─── Constants ────────────────────────────────────────────────────────────────

export const API_BASE = 'https://api.nanit.com';
export const MEDIA_BASE = 'https://media-web-secured.nanit.com';
export const BABY_UID = 'ac5dd0b2';
export const STREAM_URL = `${MEDIA_BASE}/hls/babies/${BABY_UID}.m3u8`;
export const TOKENS_URL = `${MEDIA_BASE}/babies/${BABY_UID}/tokens`;

export const API_HEADERS = {
  'content-type': 'application/json',
  'nanit-api-version': '1',
  'accept': 'application/json',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
  email: string;
  password: string;
}

// ─── IPC Fetch ────────────────────────────────────────────────────────────────

export async function ipcFetch(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
  ok: boolean; status: number; statusText: string; headers: Record<string, string>; body: string;
}> {
  // @ts-ignore
  return window.electron.invoke('drift:fetch', {
    url,
    method: options?.method || 'GET',
    headers: options?.headers,
    body: options?.body,
  });
}

// ─── Token Refresh ────────────────────────────────────────────────────────────

export async function apiRefresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const resp = await fetch(`${API_BASE}/tokens/refresh`, {
    method: 'POST',
    headers: API_HEADERS,
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await resp.json();
  logger.info('Nanit API refresh', { status: resp.status, keys: Object.keys(data) });

  if (data.access_token) {
    return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken };
  }
  throw new Error(data.error || data.message || `Token refresh failed (${resp.status})`);
}

/**
 * Check stored auth and refresh if expired.
 * Returns a valid access token or null.
 */
export async function getValidToken(
  storedAuth: StoredAuth | null,
  setStoredAuth: (auth: StoredAuth | null) => void,
): Promise<string | null> {
  if (!storedAuth) return null;

  // Still valid
  if (storedAuth.tokenExpiry > Date.now()) {
    return storedAuth.accessToken;
  }

  // Try refresh
  if (storedAuth.refreshToken) {
    try {
      const { accessToken, refreshToken } = await apiRefresh(storedAuth.refreshToken);
      let expiry = Date.now() + 4 * 60 * 60 * 1000;
      try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]));
        if (payload.exp) expiry = payload.exp * 1000;
      } catch {}
      setStoredAuth({ ...storedAuth, accessToken, refreshToken, tokenExpiry: expiry });
      return accessToken;
    } catch (err) {
      logger.warn('Nanit token refresh failed', { err: String(err) });
      return null;
    }
  }

  return null;
}

// ─── HLS Config ───────────────────────────────────────────────────────────────

export const LOW_LATENCY_HLS_CONFIG = {
  liveSyncDurationCount: 1,
  liveMaxLatencyDurationCount: 3,
  liveDurationInfinity: true,
  highBufferWatchdogPeriod: 1,
  maxBufferLength: 5,
  maxMaxBufferLength: 10,
};
