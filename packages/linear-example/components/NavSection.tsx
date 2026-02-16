import { NavSection, NavItem, NavSettingsButton, NavHeaderActions } from '@drift/ui/components';
import { LinearIcon } from '@drift/ui/components';
import { useEntityQuery, gql, logger, useEntityDrawer, useEntitySelection, buildEntityURI } from '@drift/plugin-api';
import { useLinearSettings } from './useLinearSettings';

const GET_LINEAR_ISSUES = gql`
  query GetLinearIssues($limit: Int, $teamId: ID, $assignmentFilter: String, $statusTypes: [String!]) {
    linearIssues(limit: $limit, teamId: $teamId, assignmentFilter: $assignmentFilter, statusTypes: $statusTypes) {
      id
      title
      identifier
      status
      stateName
      priority
      priorityLabel
      assigneeName
      teamKey
      url
      description
      labels { name color }
      projectName
    }
  }
`;

interface LinearIssueLabel {
  name: string;
  color: string;
}

interface LinearIssue {
  id: string;
  title: string;
  identifier: string;
  status: string;
  stateName: string;
  priority: number;
  priorityLabel: string;
  assigneeName?: string;
  teamKey?: string;
  url?: string;
  labels?: LinearIssueLabel[];
  projectName?: string;
}

const priorityColors: Record<number, string> = {
  1: 'var(--status-error)',    // Urgent
  2: 'var(--status-warning)',  // High
  3: 'var(--text-secondary)',  // Normal
  4: 'var(--text-muted)',      // Low
};

function groupIssues(issues: LinearIssue[], groupBy: string): Map<string, LinearIssue[]> {
  const groups = new Map<string, LinearIssue[]>();
  for (const issue of issues) {
    let key: string;
    switch (groupBy) {
      case 'status':
        key = issue.stateName || 'Unknown';
        break;
      case 'priority':
        key = issue.priorityLabel || 'No priority';
        break;
      case 'label':
        key = issue.labels?.[0]?.name || 'No Label';
        break;
      case 'project':
        key = issue.projectName || 'No Project';
        break;
      default:
        key = '';
    }
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(issue);
  }
  return groups;
}

function IssueNavItem({ issue, onSelect }: { issue: LinearIssue; onSelect: () => void }) {
  return (
    <NavItem
      key={issue.id}
      item={{
        id: issue.id,
        label: issue.title || '(No title)',
        variant: 'item' as const,
        meta: (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {issue.priority > 0 && (
              <span style={{ color: priorityColors[issue.priority] || 'var(--text-muted)', fontWeight: 600 }}>
                P{issue.priority}
              </span>
            )}
            <span>{issue.identifier}</span>
          </span>
        ),
      }}
      onSelect={onSelect}
    />
  );
}

export default function LinearNav() {
  const [settings] = useLinearSettings();
  const { select } = useEntitySelection();
  const { data, loading, error } = useEntityQuery(GET_LINEAR_ISSUES, {
    variables: {
      limit: settings.limit,
      teamId: settings.teamId === 'all' ? undefined : settings.teamId,
      assignmentFilter: settings.assignment === 'all' ? undefined : settings.assignment,
      statusTypes: settings.statusTypes,
    },
  });
  const { openEntityDrawer } = useEntityDrawer();

  const issues: LinearIssue[] = data?.linearIssues ?? [];

  const section = {
    id: 'linear-issues',
    label: `Linear${issues.length ? ` (${issues.length})` : ''}`,
    icon: <LinearIcon size={12} />,
    items: [],
    isLoading: loading && !data,
    emptyState: error && !data ? error.message : 'No issues found',
    hoverActions: (
      <NavHeaderActions>
        <NavSettingsButton
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            select({ id: 'settings', type: 'drawer', data: {} });
          }}
          ariaLabel="Linear settings"
        />
      </NavHeaderActions>
    ),
  };

  if (error && !data) {
    logger.error('Failed to load Linear issues', { error: error.message });
  }

  const handleIssueSelect = (issue: LinearIssue) => {
    logger.info('Linear issue selected', { issueId: issue.id, identifier: issue.identifier });
    openEntityDrawer(buildEntityURI('linear_issue', issue.id, issue.title));
  };

  // Render with grouping
  if (settings.groupBy !== 'none' && issues.length > 0) {
    const groups = groupIssues(issues, settings.groupBy);

    return (
      <NavSection section={section}>
        {Array.from(groups.entries()).map(([groupName, groupIssues]) => (
          <div key={groupName}>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '8px 12px 2px',
              }}
            >
              {groupName}
            </div>
            {groupIssues.map((issue) => (
              <IssueNavItem
                key={issue.id}
                issue={issue}
                onSelect={() => handleIssueSelect(issue)}
              />
            ))}
          </div>
        ))}
      </NavSection>
    );
  }

  return (
    <NavSection section={section}>
      {issues.map((issue) => (
        <IssueNavItem
          key={issue.id}
          issue={issue}
          onSelect={() => handleIssueSelect(issue)}
        />
      ))}
    </NavSection>
  );
}
