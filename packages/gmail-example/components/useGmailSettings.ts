import { useState, useEffect, useCallback } from 'react';

export interface GmailSettings {
  labelId: string;
  readFilter: 'all' | 'unread' | 'read';
  groupBy: 'none' | 'label' | 'date' | 'sender';
  maxResults: number;
}

export const DEFAULT_SETTINGS: GmailSettings = {
  labelId: 'INBOX',
  readFilter: 'all',
  groupBy: 'none',
  maxResults: 20,
};

const STORAGE_KEY = 'drift-plugin:gmail-example:settings';
const SYNC_EVENT = 'drift-gmail-settings-change';

function readSettings(): GmailSettings {
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

function writeSettings(settings: GmailSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage write failure
  }
}

/**
 * Shared hook for Gmail plugin settings.
 * Uses localStorage + CustomEvent to sync across React trees.
 */
export function useGmailSettings(): [GmailSettings, (update: Partial<GmailSettings>) => void] {
  const [settings, setSettings] = useState<GmailSettings>(readSettings);

  // Listen for changes from other components
  useEffect(() => {
    const handler = () => {
      setSettings(readSettings());
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const updateSettings = useCallback((update: Partial<GmailSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...update };
      writeSettings(next);
      window.dispatchEvent(new CustomEvent(SYNC_EVENT));
      return next;
    });
  }, []);

  return [settings, updateSettings];
}
