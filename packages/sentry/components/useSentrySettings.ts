import { useState, useEffect, useCallback } from 'react';

export interface SentrySettings {
  /** Default search query */
  query: string;
  /** Sort order */
  sort: 'date' | 'new' | 'freq' | 'user';
  /** Stats period */
  statsPeriod: string;
  /** Max items per section */
  limit: number;
}

export const DEFAULT_SETTINGS: SentrySettings = {
  query: 'is:unresolved',
  sort: 'date',
  statsPeriod: '14d',
  limit: 15,
};

const STORAGE_KEY = 'drift-plugin:sentry:settings';
const SYNC_EVENT = 'drift-sentry-settings-change';

function readSettings(): SentrySettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // parse failure — use defaults
  }
  return { ...DEFAULT_SETTINGS };
}

function writeSettings(settings: SentrySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage write failure
  }
}

/**
 * Shared hook for Sentry plugin settings.
 * Uses localStorage + CustomEvent to sync across React trees.
 */
export function useSentrySettings(): [SentrySettings, (update: Partial<SentrySettings>) => void] {
  const [settings, setSettings] = useState<SentrySettings>(readSettings);

  useEffect(() => {
    const handler = () => {
      setSettings(readSettings());
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const updateSettings = useCallback((update: Partial<SentrySettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...update };
      writeSettings(next);
      window.dispatchEvent(new CustomEvent(SYNC_EVENT));
      return next;
    });
  }, []);

  return [settings, updateSettings];
}
