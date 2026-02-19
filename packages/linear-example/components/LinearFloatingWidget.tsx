import { useEntityQuery, gql } from '@drift/plugin-api';

function LinearLogo({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228Z"/>
      <path d="M.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624Z"/>
      <path d="M4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855Z"/>
      <path d="M12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z"/>
    </svg>
  );
}

const GET_LINEAR_ISSUE = gql`
  query GetLinearIssueFloat($id: ID!) {
    linearIssue(id: $id) {
      id
      identifier
      title
      status
      stateName
      priority
      priorityLabel
      assigneeName
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
  url?: string;
}

const priorityColors: Record<number, string> = {
  1: 'var(--status-error, #e5484d)',
  2: 'var(--status-warning, #e5933a)',
  3: 'var(--text-secondary, #8b8d98)',
  4: 'var(--text-muted, #6e6f78)',
};

interface FloatingWidgetProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  compact: boolean;
  messageId: string;
}

export default function LinearFloatingWidget({ pathSegments }: FloatingWidgetProps) {
  const issueId = pathSegments[0];
  const { data, loading } = useEntityQuery(GET_LINEAR_ISSUE, {
    variables: { id: issueId },
    skip: !issueId,
  });

  const issue = data?.linearIssue as LinearIssue | undefined;

  if (loading || !issue) {
    return (
      <div style={{ padding: '8px 12px 10px' }}>
        <div style={{
          height: '11px',
          width: '60px',
          borderRadius: '3px',
          background: 'var(--surface-hover)',
          marginBottom: '5px',
        }} />
        <div style={{
          height: '10px',
          width: '140px',
          borderRadius: '3px',
          background: 'var(--surface-hover)',
        }} />
      </div>
    );
  }

  const priorityColor = priorityColors[issue.priority];

  return (
    <div style={{
      padding: '8px 12px 10px',
      borderTop: `2px solid ${priorityColor || 'var(--border-muted)'}`,
    }}>
      {/* Identifier + status row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '4px',
      }}>
        <span style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          fontWeight: 600,
          color: '#5E6AD2',
        }}>
          <LinearLogo size={9} />
          {issue.identifier || issue.id}
        </span>
        {issue.stateName && (
          <span style={{
            fontSize: '10px',
            padding: '1px 5px',
            borderRadius: '3px',
            background: 'var(--surface-hover)',
            color: 'var(--text-secondary)',
            fontWeight: 500,
          }}>
            {issue.stateName}
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{
        fontSize: '12px',
        fontWeight: 500,
        color: 'var(--text-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        marginBottom: issue.assigneeName ? '4px' : 0,
      }}>
        {issue.title}
      </div>

      {/* Assignee + open link row */}
      {(issue.assigneeName || issue.url) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '10px',
          color: 'var(--text-muted)',
        }}>
          <span>{issue.assigneeName}</span>
          {issue.url && (
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#5E6AD2', textDecoration: 'none' }}
              onClick={(e) => e.stopPropagation()}
            >
              Open ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
