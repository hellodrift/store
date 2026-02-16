import { useState, useEffect, useCallback } from 'react';

export interface LinearSettings {
  teamId: string;
  assignment: 'all' | 'assigned_to_me' | 'created_by_me';
  statusTypes: string[];
  groupBy: 'none' | 'status' | 'priority' | 'label' | 'project';
  limit: number;
}

export const DEFAULT_SETTINGS: LinearSettings = {
  teamId: 'all',
  assignment: 'all',
  statusTypes: ['started', 'unstarted'],
  groupBy: 'none',
  limit: 20,
};

const STORAGE_KEY = 'drift-plugin:linear-example:settings';
const SYNC_EVENT = 'drift-linear-settings-change';

function readSettings(): LinearSettings {
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

function writeSettings(settings: LinearSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage write failure
  }
}

/**
 * Shared hook for Linear plugin settings.
 * Uses localStorage + CustomEvent to sync across React trees.
 */
export function useLinearSettings(): [LinearSettings, (update: Partial<LinearSettings>) => void] {
  const [settings, setSettings] = useState<LinearSettings>(readSettings);

  // Listen for changes from other components
  useEffect(() => {
    const handler = () => {
      setSettings(readSettings());
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const updateSettings = useCallback((update: Partial<LinearSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...update };
      writeSettings(next);
      window.dispatchEvent(new CustomEvent(SYNC_EVENT));
      return next;
    });
  }, []);

  return [settings, updateSettings];
}
