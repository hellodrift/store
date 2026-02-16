import { useState, useEffect, useCallback } from 'react';

export interface SlackChannelTypes {
  publicChannel: boolean;
  privateChannel: boolean;
  im: boolean;
  mpim: boolean;
}

export interface SlackSettings {
  pollInterval: number;
  channelTypes: SlackChannelTypes;
  limit: number;
  sortOrder: 'unread_first' | 'alphabetical';
}

export const DEFAULT_SETTINGS: SlackSettings = {
  pollInterval: 60_000,
  channelTypes: {
    publicChannel: true,
    privateChannel: true,
    im: true,
    mpim: false,
  },
  limit: 30,
  sortOrder: 'unread_first',
};

const STORAGE_KEY = 'drift-plugin:slack:settings';
const SYNC_EVENT = 'drift-slack-settings-change';

function readSettings(): SlackSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        channelTypes: { ...DEFAULT_SETTINGS.channelTypes, ...parsed.channelTypes },
      };
    }
  } catch {
    // parse failure — use defaults
  }
  return { ...DEFAULT_SETTINGS };
}

function writeSettings(settings: SlackSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage write failure
  }
}

/**
 * Converts channelTypes booleans into the Slack API types string.
 * e.g. { publicChannel: true, privateChannel: true, im: true, mpim: false }
 *   → "public_channel,private_channel,im"
 */
export function buildTypesString(channelTypes: SlackChannelTypes): string {
  const mapping: [keyof SlackChannelTypes, string][] = [
    ['publicChannel', 'public_channel'],
    ['privateChannel', 'private_channel'],
    ['im', 'im'],
    ['mpim', 'mpim'],
  ];
  return mapping
    .filter(([key]) => channelTypes[key])
    .map(([, value]) => value)
    .join(',');
}

/**
 * Shared hook for Slack plugin settings.
 * Uses localStorage + CustomEvent to sync across React trees.
 */
export function useSlackSettings(): [SlackSettings, (update: Partial<SlackSettings>) => void] {
  const [settings, setSettings] = useState<SlackSettings>(readSettings);

  useEffect(() => {
    const handler = () => {
      setSettings(readSettings());
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const updateSettings = useCallback((update: Partial<SlackSettings>) => {
    setSettings((prev) => {
      const next = {
        ...prev,
        ...update,
        channelTypes: update.channelTypes
          ? { ...prev.channelTypes, ...update.channelTypes }
          : prev.channelTypes,
      };
      writeSettings(next);
      window.dispatchEvent(new CustomEvent(SYNC_EVENT));
      return next;
    });
  }, []);

  return [settings, updateSettings];
}
