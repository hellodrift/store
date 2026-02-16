import { useEntityQuery, gql, logger } from '@drift/plugin-api';

const GET_LINEAR_ISSUE = gql`
  query GetLinearIssue($id: ID!) {
    linearIssue(id: $id) {
      id
      identifier
      title
      status
      stateName
      priority
      priorityLabel
      assigneeName
      teamKey
      url
    }
  }
`;

interface LinearIssue {
  id: string;
  identifier?: string;
  title: string;
  status?: string;
  stateName?: string;
  priority: number;
  priorityLabel?: string;
  assigneeName?: string;
  teamKey?: string;
  url?: string;
}

interface WidgetProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  compact: boolean;
  messageId: string;
}

const priorityColors: Record<number, string> = {
  1: 'var(--status-error, #e5484d)',
  2: 'var(--status-warning, #e5933a)',
  3: 'var(--text-secondary, #8b8d98)',
  4: 'var(--text-muted, #6e6f78)',
};

function LinearChip({
  issue,
  loading,
  label,
}: {
  issue?: LinearIssue;
  loading: boolean;
  label?: string;
}) {
  if (loading) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '1px 6px',
          borderRadius: '4px',
          fontSize: '12px',
          background: 'var(--surface-subtle)',
          color: 'var(--text-muted)',
        }}
      >
        Loading...
      </span>
    );
  }

  if (!issue) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '1px 6px',
          borderRadius: '4px',
          fontSize: '12px',
          background: 'var(--surface-subtle)',
          color: 'var(--text-muted)',
        }}
      >
        {label || 'Unknown issue'}
      </span>
    );
  }

  const priorityColor = priorityColors[issue.priority];
  const displayText = issue.identifier
    ? `${issue.identifier} · ${issue.title}`
    : issue.title;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '1px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: 500,
        background: '#5E6AD2',
        color: '#fff',
        borderLeft: priorityColor ? `3px solid ${priorityColor}` : undefined,
        maxWidth: '300px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {displayText}
    </span>
  );
}

function LinearCard({
  issue,
  loading,
  error,
}: {
  issue?: LinearIssue;
  loading: boolean;
  error?: { message: string };
}) {
  if (loading) {
    return (
      <div
        style={{
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid var(--border-muted)',
          background: 'var(--surface-subtle)',
        }}
      >
        <div
          style={{
            height: '14px',
            width: '80px',
            borderRadius: '4px',
            background: 'var(--surface-hover)',
            marginBottom: '8px',
          }}
        />
        <div
          style={{
            height: '12px',
            width: '200px',
            borderRadius: '4px',
            background: 'var(--surface-hover)',
          }}
        />
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div
        style={{
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid var(--border-muted)',
          background: 'var(--surface-subtle)',
          color: 'var(--text-muted)',
          fontSize: '12px',
        }}
      >
        {error ? `Failed to load issue: ${error.message}` : 'Issue not found'}
      </div>
    );
  }

  const priorityColor = priorityColors[issue.priority] || 'var(--text-muted)';

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        borderTop: '1px solid var(--border-muted)',
        borderRight: '1px solid var(--border-muted)',
        borderBottom: '1px solid var(--border-muted)',
        borderLeft: `3px solid ${priorityColor}`,
        background: 'var(--surface-subtle)',
      }}
    >
      {/* Header: Identifier + Status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '6px',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#5E6AD2' }}>
          {issue.identifier || issue.id}
        </span>
        {issue.stateName && (
          <span
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'var(--surface-hover)',
              color: 'var(--text-secondary)',
              fontWeight: 500,
            }}
          >
            {issue.stateName}
          </span>
        )}
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--text-primary)',
          marginBottom: '8px',
          lineHeight: 1.3,
        }}
      >
        {issue.title}
      </div>

      {/* Metadata row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '11px',
          color: 'var(--text-muted)',
        }}
      >
        {issue.priorityLabel && (
          <span style={{ color: priorityColor, fontWeight: 600 }}>
            {issue.priorityLabel}
          </span>
        )}
        {issue.assigneeName && <span>{issue.assigneeName}</span>}
        {issue.teamKey && <span>{issue.teamKey}</span>}
        {issue.url && (
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#5E6AD2',
              textDecoration: 'none',
              marginLeft: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            Open in Linear
          </a>
        )}
      </div>
    </div>
  );
}

export default function LinearWidget({
  uri,
  entityType,
  pathSegments,
  label,
  compact,
}: WidgetProps) {
  const issueId = pathSegments[0];
  const { data, loading, error } = useEntityQuery(GET_LINEAR_ISSUE, {
    variables: { id: issueId },
    skip: !issueId,
  });

  const issue = data?.linearIssue as LinearIssue | undefined;

  if (error) {
    logger.error('Failed to load linear issue for widget', {
      issueId,
      uri,
      error: error.message,
    });
  }

  if (compact) {
    return <LinearChip issue={issue} loading={loading} label={label} />;
  }
  return <LinearCard issue={issue} loading={loading} error={error} />;
}
