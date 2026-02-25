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
  Input,
} from '@drift/ui';
import { useEntityQuery, gql, logger } from '@drift/plugin-api';
import { useSentrySettings, DEFAULT_SETTINGS } from './useSentrySettings';

const GET_CONNECTION_STATUS = gql`
  query GetSentryConnectionStatus {
    sentryConnectionStatus {
      connected
      organizationName
      organizationSlug
    }
  }
`;

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'date', label: 'Last seen' },
  { value: 'new', label: 'First seen' },
  { value: 'freq', label: 'Most events' },
  { value: 'user', label: 'Most users' },
];

const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const LIMIT_OPTIONS = [5, 10, 15, 20, 50];

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
  const [settings, updateSettings] = useSentrySettings();
  const { data: statusData } = useEntityQuery(GET_CONNECTION_STATUS);
  const status = statusData?.sentryConnectionStatus;

  const handleReset = () => {
    updateSettings(DEFAULT_SETTINGS);
    logger.info('Sentry settings reset to defaults');
  };

  return (
    <>
      <DrawerHeaderTitle>Sentry Settings</DrawerHeaderTitle>

      <DrawerBody>

      {/* Connection Status */}
      <ContentSection title="Connection">
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 12px', borderRadius: '6px',
          background: status?.connected ? 'var(--status-success-subtle, rgba(70,167,88,0.1))' : 'var(--surface-subtle)',
          border: `1px solid ${status?.connected ? 'var(--status-success, #46a758)' : 'var(--border-muted)'}`,
        }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: status?.connected ? 'var(--status-success, #46a758)' : 'var(--text-muted)',
          }} />
          <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
            {status?.connected
              ? `Connected to ${status.organizationName ?? status.organizationSlug}`
              : 'Not connected'
            }
          </span>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
          Configure your Sentry token and organization in the integration settings.
          Go to Settings → Integrations → Sentry to set up authentication.
        </p>
      </ContentSection>

      <Separator />

      {/* Default Query */}
      <ContentSection title="Default query">
        <Input
          value={settings.query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSettings({ query: e.target.value })}
          placeholder="is:unresolved level:error"
        />
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Sentry search syntax. Examples: is:unresolved, level:error, assigned:me
        </p>
      </ContentSection>

      <Separator />

      {/* Sort Order */}
      <ContentSection title="Sort order">
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {SORT_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={settings.sort === opt.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => updateSettings({ sort: opt.value as any })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </ContentSection>

      <Separator />

      {/* Stats Period */}
      <ContentSection title="Time period">
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {PERIOD_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={settings.statsPeriod === opt.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => updateSettings({ statsPeriod: opt.value })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </ContentSection>

      <Separator />

      {/* Limit */}
      <ContentSection title="Items per section">
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
                {n} items
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
