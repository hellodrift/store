import { useState, useEffect, useCallback } from 'react';

export interface TrelloSettings {
  boardId?: string;
  boardName?: string;
  activeTab: 'my-cards' | 'board';
  limit: number;
}

export const DEFAULT_SETTINGS: TrelloSettings = {
  boardId: undefined,
  boardName: undefined,
  activeTab: 'my-cards',
  limit: 20,
};

const STORAGE_KEY = 'drift-plugin:trello:settings';
const SYNC_EVENT = 'drift-trello-settings-change';

function readSettings(): TrelloSettings {
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

function writeSettings(settings: TrelloSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage write failure
  }
}

/**
 * Shared hook for Trello plugin settings.
 * Uses localStorage + CustomEvent to sync across React trees.
 */
export function useTrelloSettings(): [TrelloSettings, (update: Partial<TrelloSettings>) => void] {
  const [settings, setSettings] = useState<TrelloSettings>(readSettings);

  // Listen for changes from other components (e.g. SettingsDrawer)
  useEffect(() => {
    const handler = () => {
      setSettings(readSettings());
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const updateSettings = useCallback((update: Partial<TrelloSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...update };
      writeSettings(next);
      window.dispatchEvent(new CustomEvent(SYNC_EVENT));
      return next;
    });
  }, []);

  return [settings, updateSettings];
}
