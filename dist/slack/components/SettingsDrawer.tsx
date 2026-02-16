import {
  DrawerHeaderTitle,
  DrawerBody,
  ContentSection,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Separator,
  Label,
  Checkbox,
} from '@drift/ui';
import { logger } from '@drift/plugin-api';
import { useSlackSettings, DEFAULT_SETTINGS, buildTypesString } from './useSlackSettings';
import type { SlackSettings, SlackChannelTypes } from './useSlackSettings';

const POLL_INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 15_000, label: '15 seconds' },
  { value: 30_000, label: '30 seconds' },
  { value: 60_000, label: '1 minute' },
  { value: 120_000, label: '2 minutes' },
  { value: 300_000, label: '5 minutes' },
];

const CHANNEL_TYPE_OPTIONS: { key: keyof SlackChannelTypes; label: string }[] = [
  { key: 'publicChannel', label: 'Public channels' },
  { key: 'privateChannel', label: 'Private channels' },
  { key: 'im', label: 'Direct messages' },
  { key: 'mpim', label: 'Group messages' },
];

const LIMIT_OPTIONS = [10, 20, 30, 50];

const SORT_OPTIONS: { value: SlackSettings['sortOrder']; label: string }[] = [
  { value: 'unread_first', label: 'Unread first' },
  { value: 'alphabetical', label: 'Alphabetical' },
];

interface SettingsDrawerProps {
  payload: Record<string, unknown>;
  drawer: {
    close: () => void;
    open: (payload: Record<string, unknown>) => void;
    push: (payload: Record<string, unknown>) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

export default function SettingsDrawer({ drawer }: SettingsDrawerProps) {
  const [settings, updateSettings] = useSlackSettings();

  const handleChannelTypeToggle = (key: keyof SlackChannelTypes) => {
    const next = { ...settings.channelTypes, [key]: !settings.channelTypes[key] };
    // Don't allow all to be unchecked — keep at least one
    const hasAny = Object.values(next).some(Boolean);
    if (hasAny) {
      updateSettings({ channelTypes: next });
    }
  };

  const handleReset = () => {
    updateSettings(DEFAULT_SETTINGS);
    logger.info('Slack settings reset to defaults');
  };

  return (
    <>
      <DrawerHeaderTitle>Slack Settings</DrawerHeaderTitle>

      <DrawerBody>

      {/* Refresh Interval */}
      <ContentSection title="Refresh interval">
        <Select
          value={String(settings.pollInterval)}
          onValueChange={(value) => updateSettings({ pollInterval: Number(value) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POLL_INTERVAL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
          How often to check for new messages. Shorter intervals use more API calls.
        </p>
      </ContentSection>

      <Separator />

      {/* Channel Types */}
      <ContentSection title="Channel types">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {CHANNEL_TYPE_OPTIONS.map((opt) => (
            <div key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Checkbox
                id={`channel-type-${opt.key}`}
                checked={settings.channelTypes[opt.key]}
                onCheckedChange={() => handleChannelTypeToggle(opt.key)}
              />
              <Label
                htmlFor={`channel-type-${opt.key}`}
                style={{ fontSize: '13px', cursor: 'pointer' }}
              >
                {opt.label}
              </Label>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
          Currently showing: {buildTypesString(settings.channelTypes) || 'none'}
        </p>
      </ContentSection>

      <Separator />

      {/* Channel Limit */}
      <ContentSection title="Channel limit">
        <Select
          value={String(settings.limit)}
          onValueChange={(value) => updateSettings({ limit: Number(value) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIMIT_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} channels
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ContentSection>

      <Separator />

      {/* Sort Order */}
      <ContentSection title="Sort order">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {SORT_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={settings.sortOrder === opt.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => updateSettings({ sortOrder: opt.value })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </ContentSection>

      <Separator />

      {/* Reset */}
      <ContentSection>
        <Button variant="outline" size="sm" onClick={handleReset} style={{ width: '100%' }}>
          Reset to defaults
        </Button>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center' }}>
          Settings are saved automatically
        </p>
      </ContentSection>

      </DrawerBody>
    </>
  );
}
