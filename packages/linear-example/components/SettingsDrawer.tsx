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
import { useEntityQuery, gql, logger } from '@drift/plugin-api';
import { useLinearSettings, DEFAULT_SETTINGS } from './useLinearSettings';
import type { LinearSettings } from './useLinearSettings';

const GET_TEAMS = gql`
  query GetLinearTeams {
    linearTeams {
      id
      name
      key
    }
  }
`;

interface Team {
  id: string;
  name: string;
  key: string;
}

const STATUS_TYPE_OPTIONS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'unstarted', label: 'Unstarted' },
  { value: 'started', label: 'Started' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const ASSIGNMENT_OPTIONS: { value: LinearSettings['assignment']; label: string }[] = [
  { value: 'all', label: 'All issues' },
  { value: 'assigned_to_me', label: 'Assigned to me' },
  { value: 'created_by_me', label: 'Created by me' },
];

const GROUP_BY_OPTIONS: { value: LinearSettings['groupBy']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'label', label: 'Label' },
  { value: 'project', label: 'Project' },
];

const LIMIT_OPTIONS = [10, 20, 50, 100];

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
  const [settings, updateSettings] = useLinearSettings();
  const { data } = useEntityQuery(GET_TEAMS);
  const teams: Team[] = data?.linearTeams ?? [];

  const handleStatusTypeToggle = (type: string) => {
    const current = settings.statusTypes;
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    // Don't allow empty — keep at least one
    if (next.length > 0) {
      updateSettings({ statusTypes: next });
    }
  };

  const handleReset = () => {
    updateSettings(DEFAULT_SETTINGS);
    logger.info('Linear settings reset to defaults');
  };

  return (
    <>
      <DrawerHeaderTitle>Linear Settings</DrawerHeaderTitle>

      <DrawerBody>

      {/* Team Filter */}
      <ContentSection title="Team">
        <Select
          value={settings.teamId}
          onValueChange={(value) => updateSettings({ teamId: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.key} — {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ContentSection>

      <Separator />

      {/* Assignment Filter */}
      <ContentSection title="Assignment">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {ASSIGNMENT_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={settings.assignment === opt.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => updateSettings({ assignment: opt.value })}
              style={{ justifyContent: 'flex-start' }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </ContentSection>

      <Separator />

      {/* Status Types */}
      <ContentSection title="Status types">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {STATUS_TYPE_OPTIONS.map((opt) => (
            <div key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Checkbox
                id={`status-${opt.value}`}
                checked={settings.statusTypes.includes(opt.value)}
                onCheckedChange={() => handleStatusTypeToggle(opt.value)}
              />
              <Label
                htmlFor={`status-${opt.value}`}
                style={{ fontSize: '13px', cursor: 'pointer' }}
              >
                {opt.label}
              </Label>
            </div>
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

      {/* Issue Limit */}
      <ContentSection title="Issue limit">
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
                {n} issues
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
