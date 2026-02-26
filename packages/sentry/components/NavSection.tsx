import { NavSection, NavItem, NavSettingsButton, NavHeaderActions } from '@drift/ui/components';
import { useEntityQuery, gql, logger, useEntityDrawer, useEntitySelection, buildEntityURI } from '@drift/plugin-api';
import { useSentrySettings } from './useSentrySettings';

const GET_ISSUES = gql`
  query GetSentryIssues($query: String, $sort: String, $statsPeriod: String, $limit: Int) {
    sentryIssues(query: $query, sort: $sort, statsPeriod: $statsPeriod, limit: $limit) {
      id
      shortId
      title
      level
      status
      count
      userCount
      lastSeen
      project { slug name }
    }
  }
`;

interface SentryIssueNav {
  id: string;
  shortId: string;
  title: string;
  level: string;
  status: string;
  count: string;
  userCount: number;
  lastSeen: string;
  project: { slug: string; name: string };
}

const levelColors: Record<string, string> = {
  fatal: 'var(--status-error, #e5484d)',
  error: '#e5933a',
  warning: '#f5d90a',
  info: '#3b82f6',
  debug: 'var(--text-muted, #6e6f78)',
};

function IssueNavItem({ issue, onSelect }: { issue: SentryIssueNav; onSelect: () => void }) {
  const dotColor = levelColors[issue.level] ?? 'var(--text-muted)';

  return (
    <NavItem
      key={issue.id}
      item={{
        id: issue.id,
        label: issue.title || '(No title)',
        variant: 'item' as const,
        meta: (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: dotColor,
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            <span>{issue.shortId}</span>
            <span style={{ color: 'var(--text-muted)' }}>{issue.project.name}</span>
          </span>
        ),
      }}
      onSelect={onSelect}
    />
  );
}

export default function SentryNav() {
  const [settings] = useSentrySettings();
  const { select } = useEntitySelection();
  const { openEntityDrawer } = useEntityDrawer();

  const { data, loading, error } = useEntityQuery(GET_ISSUES, {
    variables: {
      query: settings.query,
      sort: settings.sort,
      statsPeriod: settings.statsPeriod,
      limit: settings.limit,
    },
  });

  const issues: SentryIssueNav[] = data?.sentryIssues ?? [];

  if (error && !data) {
    logger.error('Failed to load Sentry issues', { error: error.message });
  }

  const handleIssueSelect = (issue: SentryIssueNav) => {
    logger.info('Sentry issue selected', { id: issue.id, shortId: issue.shortId });
    openEntityDrawer(buildEntityURI('sentry_issue', issue.id, `${issue.shortId} ${issue.title}`));
  };

  const section = {
    id: 'sentry-issues',
    label: `Sentry${issues.length ? ` (${issues.length})` : ''}`,
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
          ariaLabel="Sentry settings"
        />
      </NavHeaderActions>
    ),
  };

  return (
    <NavSection section={section}>
      {issues.map((issue) => (
        <IssueNavItem key={issue.id} issue={issue} onSelect={() => handleIssueSelect(issue)} />
      ))}
    </NavSection>
  );
}
