/**
 * Linear Workstream Settings Section
 *
 * Rendered inside the Workstream Settings Drawer via the
 * `workstream-settings-drawer` canvas. Shows a summary of the current
 * Linear configuration and provides quick access to Linear settings.
 *
 * Props received from the core:
 * - workstreamId: the active workstream ID
 * - drawer: { push, pop, canPop } for navigation
 */

import {
  Button,
  MetadataList,
  MetadataRow,
} from '@drift/ui';
import { useEntityQuery, gql } from '@drift/plugin-api';
import { useLinearSettings } from './useLinearSettings';
import { TicketIcon, UsersIcon, FilterIcon, SlidersHorizontalIcon } from 'lucide-react';

const GET_LINEAR_ISSUE_COUNT = gql`
  query GetLinearIssueCount($teamId: ID, $assignmentFilter: String, $statusTypes: [String!]) {
    linearIssues(limit: 100, teamId: $teamId, assignmentFilter: $assignmentFilter, statusTypes: $statusTypes) {
      id
      stateName
    }
  }
`;

const GET_TEAMS = gql`
  query GetLinearTeamsForSection {
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

interface LinearIssue {
  id: string;
  stateName: string;
}

interface WorkstreamSectionProps {
  workstreamId: string;
  drawer: {
    push: (payload: Record<string, unknown>) => void;
    pop: () => void;
    canPop: boolean;
  };
}

export default function WorkstreamSection({ drawer }: WorkstreamSectionProps) {
  const [settings] = useLinearSettings();

  const { data: issueData, loading: issuesLoading } = useEntityQuery(GET_LINEAR_ISSUE_COUNT, {
    variables: {
      teamId: settings.teamId === 'all' ? undefined : settings.teamId,
      assignmentFilter: settings.assignment,
      statusTypes: settings.statusTypes,
    },
  });

  const { data: teamsData } = useEntityQuery(GET_TEAMS);

  const issues: LinearIssue[] = issueData?.linearIssues ?? [];
  const teams: Team[] = teamsData?.linearTeams ?? [];

  const selectedTeam = settings.teamId === 'all'
    ? null
    : teams.find((t) => t.id === settings.teamId);

  const teamLabel = selectedTeam
    ? `${selectedTeam.key} — ${selectedTeam.name}`
    : 'All teams';

  const assignmentLabel: Record<string, string> = {
    all: 'All issues',
    assigned_to_me: 'Assigned to me',
    created_by_me: 'Created by me',
  };

  const handleOpenSettings = () => {
    drawer.push({ view: 'settings' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Issue count summary */}
      <MetadataList>
        <MetadataRow
          icon={<TicketIcon />}
          label="Issues"
          value={
            issuesLoading
              ? 'Loading…'
              : `${issues.length} matching`
          }
        />
        <MetadataRow
          icon={<UsersIcon />}
          label="Team"
          value={teamLabel}
        />
        <MetadataRow
          icon={<FilterIcon />}
          label="Assignment"
          value={assignmentLabel[settings.assignment] ?? settings.assignment}
        />
      </MetadataList>

      {/* Open settings button */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleOpenSettings}
        style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px' }}
      >
        <SlidersHorizontalIcon style={{ width: '14px', height: '14px' }} />
        Configure Linear
      </Button>
    </div>
  );
}
