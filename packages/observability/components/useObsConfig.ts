/**
 * Shared hook for Observability plugin configuration.
 * Uses localStorage + CustomEvent to sync across React component trees.
 * Mirrors the pattern from the Linear plugin's useLinearSettings.
 */

import { useState, useEffect, useCallback } from 'react';

export interface ObsConfig {
  prometheusUrl: string;
  lokiUrl: string;
  alertmanagerUrl: string;
  grafanaUrl: string;
}

export const DEFAULT_CONFIG: ObsConfig = {
  prometheusUrl: 'http://localhost:9090',
  lokiUrl: 'http://localhost:3100',
  alertmanagerUrl: 'http://localhost:9093',
  grafanaUrl: 'http://localhost:3200',
};

const STORAGE_KEY = 'drift-plugin:@observability:config';
const SYNC_EVENT = 'drift-obs-config-change';

function readConfig(): ObsConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
  } catch {
    // parse failure — use defaults
  }
  return { ...DEFAULT_CONFIG };
}

function writeConfig(config: ObsConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // storage write failure
  }
}

export function useObsConfig(): [ObsConfig, (update: Partial<ObsConfig>) => void] {
  const [config, setConfig] = useState<ObsConfig>(readConfig);

  useEffect(() => {
    const handler = () => setConfig(readConfig());
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const updateConfig = useCallback((update: Partial<ObsConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...update };
      writeConfig(next);
      window.dispatchEvent(new CustomEvent(SYNC_EVENT));
      return next;
    });
  }, []);

  return [config, updateConfig];
}
