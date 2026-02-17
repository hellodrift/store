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
  Input,
} from '@drift/ui';
import { logger } from '@drift/plugin-api';
import { useGithubSettings, DEFAULT_SETTINGS } from './useGithubSettings';
import type { GithubSettings } from './useGithubSettings';

const PR_FILTER_OPTIONS: { value: GithubSettings['prFilter']; label: string }[] = [
  { value: 'review_requested', label: 'Review requested' },
  { value: 'authored', label: 'Authored by me' },
  { value: 'mentioned', label: 'Mentioned' },
  { value: 'assigned', label: 'Assigned to me' },
];

const PR_STATE_OPTIONS: { value: GithubSettings['prState']; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
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
  const [settings, updateSettings] = useGithubSettings();

  const handleRepoChange = (value: string) => {
    const repos = value.split(',').map((r) => r.trim()).filter(Boolean);
    updateSettings({ repos });
  };

  const handleReset = () => {
    updateSettings(DEFAULT_SETTINGS);
    logger.info('GitHub settings reset to defaults');
  };

  return (
    <>
      <DrawerHeaderTitle>GitHub Settings</DrawerHeaderTitle>

      <DrawerBody>

      {/* Repos Filter */}
      <ContentSection title="Repositories">
        <Input
          value={settings.repos.join(', ')}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleRepoChange(e.target.value)}
          placeholder="owner/repo, owner/repo2"
        />
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Comma-separated owner/repo pairs for CI/CD section. Leave empty to skip CI.
        </p>
      </ContentSection>

      <Separator />

      {/* PR Filter */}
      <ContentSection title="Pull Requests filter">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {PR_FILTER_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={settings.prFilter === opt.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => updateSettings({ prFilter: opt.value })}
              style={{ justifyContent: 'flex-start' }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </ContentSection>

      <Separator />

      {/* PR State */}
      <ContentSection title="PR state">
        <div style={{ display: 'flex', gap: '4px' }}>
          {PR_STATE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={settings.prState === opt.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => updateSettings({ prState: opt.value })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </ContentSection>

      <Separator />

      {/* CI/CD Options */}
      <ContentSection title="CI/CD">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Checkbox
              id="ci-failures-only"
              checked={settings.ciFailuresOnly}
              onCheckedChange={(checked) => updateSettings({ ciFailuresOnly: !!checked })}
            />
            <Label htmlFor="ci-failures-only" style={{ fontSize: '13px', cursor: 'pointer' }}>
              Show failures only
            </Label>
          </div>
          <Input
            value={settings.ciBranch}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSettings({ ciBranch: e.target.value })}
            placeholder="Filter by branch (e.g., main)"
          />
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
