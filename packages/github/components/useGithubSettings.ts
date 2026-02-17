import { useState, useEffect, useCallback } from 'react';

export interface GithubSettings {
  /** Comma-separated "owner/repo" strings to filter (empty = all) */
  repos: string[];
  /** PR filter type */
  prFilter: 'authored' | 'review_requested' | 'mentioned' | 'assigned';
  /** PR state */
  prState: 'open' | 'closed';
  /** CI: only show failures */
  ciFailuresOnly: boolean;
  /** CI: filter by branch */
  ciBranch: string;
  /** Max items per section */
  limit: number;
}

export const DEFAULT_SETTINGS: GithubSettings = {
  repos: [],
  prFilter: 'review_requested',
  prState: 'open',
  ciFailuresOnly: false,
  ciBranch: '',
  limit: 15,
};

const STORAGE_KEY = 'drift-plugin:github:settings';
const SYNC_EVENT = 'drift-github-settings-change';

function readSettings(): GithubSettings {
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

function writeSettings(settings: GithubSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage write failure
  }
}

/**
 * Shared hook for GitHub plugin settings.
 * Uses localStorage + CustomEvent to sync across React trees.
 */
export function useGithubSettings(): [GithubSettings, (update: Partial<GithubSettings>) => void] {
  const [settings, setSettings] = useState<GithubSettings>(readSettings);

  useEffect(() => {
    const handler = () => {
      setSettings(readSettings());
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const updateSettings = useCallback((update: Partial<GithubSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...update };
      writeSettings(next);
      window.dispatchEvent(new CustomEvent(SYNC_EVENT));
      return next;
    });
  }, []);

  return [settings, updateSettings];
}
