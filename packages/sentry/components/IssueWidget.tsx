import { useEntityQuery, gql, logger } from '@drift/plugin-api';

const GET_ISSUE = gql`
  query GetSentryIssueWidget($id: String!) {
    sentryIssue(id: $id) {
      id
      shortId
      title
      level
      status
      count
      userCount
      lastSeen
      permalink
      project { slug name }
    }
  }
`;

interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  level: string;
  status: string;
  count: string;
  userCount: number;
  lastSeen: string;
  permalink: string;
  project: { slug: string; name: string };
}

interface WidgetProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  compact: boolean;
  messageId: string;
}

const levelColors: Record<string, string> = {
  fatal: '#e5484d',
  error: '#e5933a',
  warning: '#f5d90a',
  info: '#3b82f6',
  debug: '#6e6f78',
};

const statusBadgeStyles: Record<string, { bg: string; text: string }> = {
  unresolved: { bg: 'var(--status-warning-subtle, rgba(229,147,58,0.15))', text: '#e5933a' },
  resolved: { bg: 'var(--status-success-subtle, rgba(70,167,88,0.15))', text: '#46a758' },
  ignored: { bg: 'var(--surface-hover)', text: 'var(--text-muted)' },
};

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function IssueChip({
  issue,
  loading,
  label,
}: {
  issue?: SentryIssue;
  loading: boolean;
  label?: string;
}) {
  if (loading) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '1px 6px', borderRadius: '4px', fontSize: '12px',
        background: 'var(--surface-subtle)', color: 'var(--text-muted)',
      }}>
        Loading...
      </span>
    );
  }

  if (!issue) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '1px 6px', borderRadius: '4px', fontSize: '12px',
        background: 'var(--surface-subtle)', color: 'var(--text-muted)',
      }}>
        {label || 'Unknown issue'}
      </span>
    );
  }

  const dotColor = levelColors[issue.level] ?? 'var(--text-muted)';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '1px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 500,
      background: '#362D59', color: '#fff',
      maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: dotColor, display: 'inline-block', flexShrink: 0,
      }} />
      {issue.shortId} {issue.title}
    </span>
  );
}

function IssueCard({
  issue,
  loading,
  error,
}: {
  issue?: SentryIssue;
  loading: boolean;
  error?: { message: string };
}) {
  if (loading) {
    return (
      <div style={{
        padding: '12px 16px', borderRadius: '8px',
        border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)',
      }}>
        <div style={{ height: '14px', width: '80px', borderRadius: '4px', background: 'var(--surface-hover)', marginBottom: '8px' }} />
        <div style={{ height: '12px', width: '200px', borderRadius: '4px', background: 'var(--surface-hover)' }} />
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div style={{
        padding: '12px 16px', borderRadius: '8px',
        border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)',
        color: 'var(--text-muted)', fontSize: '12px',
      }}>
        {error ? `Failed to load issue: ${error.message}` : 'Issue not found'}
      </div>
    );
  }

  const borderColor = levelColors[issue.level] ?? 'var(--border-muted)';
  const statusStyle = statusBadgeStyles[issue.status] ?? statusBadgeStyles.unresolved;

  return (
    <div style={{
      padding: '12px 16px', borderRadius: '8px',
      borderTop: '1px solid var(--border-muted)',
      borderRight: '1px solid var(--border-muted)',
      borderBottom: '1px solid var(--border-muted)',
      borderLeft: `3px solid ${borderColor}`,
      background: 'var(--surface-subtle)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: borderColor }}>
          {issue.shortId} · {issue.project.name}
        </span>
        <span style={{
          fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
          background: statusStyle.bg, color: statusStyle.text, fontWeight: 500,
        }}>
          {issue.status}
        </span>
      </div>

      {/* Title */}
      <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '8px', lineHeight: 1.3 }}>
        {issue.title}
      </div>

      {/* Metadata */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
        <span>{issue.count} events</span>
        <span>{issue.userCount} users</span>
        <span>{formatTimeAgo(issue.lastSeen)}</span>
        {issue.permalink && (
          <a
            href={issue.permalink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#6C5FC7', textDecoration: 'none', marginLeft: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            Open in Sentry
          </a>
        )}
      </div>
    </div>
  );
}

export default function IssueWidget({
  uri,
  entityType,
  pathSegments,
  label,
  compact,
}: WidgetProps) {
  const issueId = pathSegments[0];

  const { data, loading, error } = useEntityQuery(GET_ISSUE, {
    variables: { id: issueId },
    skip: !issueId,
  });

  const issue = data?.sentryIssue as SentryIssue | undefined;

  if (error) {
    logger.error('Failed to load Sentry issue for widget', { issueId, uri, error: error.message });
  }

  if (compact) {
    return <IssueChip issue={issue} loading={loading} label={label} />;
  }
  return <IssueCard issue={issue} loading={loading} error={error} />;
}
