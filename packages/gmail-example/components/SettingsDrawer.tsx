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
} from '@drift/ui';
import { useEntityQuery, gql, logger } from '@drift/plugin-api';
import { useGmailSettings, DEFAULT_SETTINGS } from './useGmailSettings';
import type { GmailSettings } from './useGmailSettings';

const GET_LABELS = gql`
  query GetGmailLabels {
    gmailLabels {
      id
      name
      type
    }
  }
`;

interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

const READ_FILTER_OPTIONS: { value: GmailSettings['readFilter']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
];

const GROUP_BY_OPTIONS: { value: GmailSettings['groupBy']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'date', label: 'Date' },
  { value: 'sender', label: 'Sender' },
  { value: 'label', label: 'Label' },
];

const MAX_RESULTS_OPTIONS = [10, 20, 50];

const REFRESH_INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 60_000, label: '1 minute' },
  { value: 300_000, label: '5 minutes' },
  { value: 600_000, label: '10 minutes' },
  { value: 900_000, label: '15 minutes' },
  { value: 1_800_000, label: '30 minutes' },
];

// System labels to show at top
const SYSTEM_LABELS = ['INBOX', 'STARRED', 'SENT', 'DRAFT', 'TRASH', 'SPAM'];

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
  const [settings, updateSettings] = useGmailSettings();
  const { data } = useEntityQuery(GET_LABELS);
  const allLabels: GmailLabel[] = data?.gmailLabels ?? [];

  // Split into system and user labels
  const systemLabels = allLabels.filter((l) => SYSTEM_LABELS.includes(l.id));
  const userLabels = allLabels.filter((l) => l.type === 'user');

  const handleReset = () => {
    updateSettings(DEFAULT_SETTINGS);
    logger.info('Gmail settings reset to defaults');
  };

  return (
    <>
      <DrawerHeaderTitle>Gmail Settings</DrawerHeaderTitle>

      <DrawerBody>

        {/* Label/Folder Selection */}
        <ContentSection title="Label / Folder">
          <Select
            value={settings.labelId}
            onValueChange={(value) => updateSettings({ labelId: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select label" />
            </SelectTrigger>
            <SelectContent>
              {systemLabels.map((label) => (
                <SelectItem key={label.id} value={label.id}>
                  {label.name}
                </SelectItem>
              ))}
              {/* Fallback system labels if API hasn't loaded */}
              {systemLabels.length === 0 && SYSTEM_LABELS.map((id) => (
                <SelectItem key={id} value={id}>
                  {id.charAt(0) + id.slice(1).toLowerCase()}
                </SelectItem>
              ))}
              {userLabels.length > 0 && (
                <>
                  <SelectItem value="__divider__" disabled>
                    ── User Labels ──
                  </SelectItem>
                  {userLabels.map((label) => (
                    <SelectItem key={label.id} value={label.id}>
                      {label.name}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </ContentSection>

        <Separator />

        {/* Read Filter */}
        <ContentSection title="Read filter">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {READ_FILTER_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={settings.readFilter === opt.value ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => updateSettings({ readFilter: opt.value })}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </ContentSection>

        <Separator />

        {/* Group By */}
        <ContentSection title="Group by">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {GROUP_BY_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={settings.groupBy === opt.value ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => updateSettings({ groupBy: opt.value })}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </ContentSection>

        <Separator />

        {/* Max Results */}
        <ContentSection title="Messages to show">
          <Select
            value={String(settings.maxResults)}
            onValueChange={(value) => updateSettings({ maxResults: Number(value) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MAX_RESULTS_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} messages
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ContentSection>

        <Separator />

        {/* Refresh Interval */}
        <ContentSection title="Refresh interval">
          <Select
            value={String(settings.refreshInterval)}
            onValueChange={(value) => updateSettings({ refreshInterval: Number(value) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REFRESH_INTERVAL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
