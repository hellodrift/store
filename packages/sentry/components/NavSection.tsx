import { NavSection, NavItem, NavSettingsButton, NavHeaderActions } from '@drift/ui/components';
import { useEntityQuery, gql, logger, useEntityDrawer, useEntitySelection, buildEntityURI } from '@drift/plugin-api';

function SentryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.904 7.92a15.478 15.478 0 0 1 8.53 12.811h-2.221A13.301 13.301 0 0 0 5.784 9.814l-2.926 5.06a7.65 7.65 0 0 1 4.435 5.848H2.194a.365.365 0 0 1-.298-.534l1.413-2.402a5.16 5.16 0 0 0-1.614-.913L.296 19.275a2.182 2.182 0 0 0 .812 2.999 2.24 2.24 0 0 0 1.086.288h6.983a9.322 9.322 0 0 0-3.845-8.318l1.11-1.922a11.47 11.47 0 0 1 4.95 10.24h5.915a17.242 17.242 0 0 0-7.885-15.28l2.244-3.845a.37.37 0 0 1 .504-.13c.255.14 9.75 16.708 9.928 16.9a.365.365 0 0 1-.327.543h-2.287c.029.612.029 1.223 0 1.831h2.297a2.206 2.206 0 0 0 1.922-3.31z" />
    </svg>
  );
}
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
    icon: <SentryIcon />,
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
