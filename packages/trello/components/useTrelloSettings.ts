import { useState, useEffect, useCallback } from 'react';

export interface TrelloSettings {
  /** 'mine' = cards assigned/relevant to me; 'all' = all cards on configured boards */
  showMode: 'mine' | 'all';
  /** Board IDs to show in nav. Empty array = all accessible boards (up to 10). */
  boardIds: string[];
  /** Cache: boardId → boardName, populated when user selects boards in settings. */
  boardNames: Record<string, string>;
  /** When true and only one board is present, render cards flat (no board folder). Default: true. */
  flatIfSingleBoard: boolean;
  /** When true, show list sub-folders under each board. When false, cards appear directly under boards. Default: true. */
  showListLevel: boolean;
  /** Max cards to fetch. */
  limit: number;
}

export const DEFAULT_SETTINGS: TrelloSettings = {
  showMode: 'all',
  boardIds: [],
  boardNames: {},
  flatIfSingleBoard: true,
  showListLevel: true,
  limit: 50,
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
