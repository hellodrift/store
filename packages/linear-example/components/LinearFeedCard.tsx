/**
 * Linear Feed Card
 *
 * feed-card canvas for linear_issue entities.
 * Renders a rich ticket summary directly in the feed.
 *
 * Props follow the feed-card contract:
 *   { uri, entityType, pathSegments, title, subtitle, metadata, size }
 *
 * Click behavior:
 *   - Default: FeedWidgetSlot opens the linear_issue entity-drawer (TicketDrawer)
 *     because linear-example registers an entity-drawer for linear_issue.
 *   - Override: feed generator can set an explicit `action` on the widget
 *     (e.g. { type: 'url', href: issue.url } to open Linear directly, or
 *      { type: 'navigate', target: 'entity:@drift//linear_issue/<id>' } explicitly).
 */

import { useEntityQuery, gql } from '@drift/plugin-api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeedCardProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  title?: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
  size: 'small' | 'medium' | 'large' | 'full';
}

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
  description?: string;
  labels?: Array<{ id: string; name: string; color: string }>;
}

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const GET_LINEAR_ISSUE = gql`
  query GetLinearIssueForFeed($id: ID!) {
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
      description
      labels { id name color }
    }
  }
`;

// ─── Style Helpers ────────────────────────────────────────────────────────────

const priorityColors: Record<number, string> = {
  1: '#e5484d', // urgent
  2: '#e5933a', // high
  3: '#8b8d98', // normal
  4: '#6e6f78', // low
};

function LinearLogo({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228Z"/>
      <path d="M.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624Z"/>
      <path d="M4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855Z"/>
      <path d="M12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z"/>
    </svg>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonLine({ width, height = 12 }: { width: string | number; height?: number }) {
  return (
    <div style={{
      height,
      width,
      borderRadius: 4,
      background: 'var(--surface-hover)',
    }} />
  );
}

// ─── Card Variants ────────────────────────────────────────────────────────────

function SmallCard({ issue, loading }: { issue?: LinearIssue; loading: boolean }) {
  if (loading || !issue) {
    return (
      <div style={{
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <SkeletonLine width={60} height={10} />
        <SkeletonLine width="80%" height={12} />
      </div>
    );
  }

  const priorityColor = priorityColors[issue.priority];

  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 8,
      border: '1px solid var(--border-muted)',
      borderLeft: `3px solid ${priorityColor || 'var(--border-muted)'}`,
      background: 'var(--surface-subtle)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ color: '#5E6AD2', display: 'flex', alignItems: 'center' }}>
          <LinearLogo size={10} />
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#5E6AD2' }}>
          {issue.identifier || issue.id}
        </span>
      </div>
      <div style={{
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--text-primary)',
        lineHeight: 1.3,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      }}>
        {issue.title}
      </div>
    </div>
  );
}

function MediumCard({ issue, loading }: { issue?: LinearIssue; loading: boolean }) {
  if (loading || !issue) {
    return (
      <div style={{
        padding: '14px 16px',
        borderRadius: 10,
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <SkeletonLine width={80} height={11} />
          <SkeletonLine width={60} height={11} />
        </div>
        <SkeletonLine width="90%" height={14} />
        <SkeletonLine width="60%" height={11} />
      </div>
    );
  }

  const priorityColor = priorityColors[issue.priority];

  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: 10,
      border: '1px solid var(--border-muted)',
      borderLeft: `3px solid ${priorityColor || 'var(--border-muted)'}`,
      background: 'var(--surface-subtle)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#5E6AD2', display: 'flex', alignItems: 'center' }}>
            <LinearLogo size={11} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#5E6AD2' }}>
            {issue.identifier || issue.id}
          </span>
        </div>
        {issue.stateName && (
          <span style={{
            fontSize: 10,
            padding: '2px 7px',
            borderRadius: 4,
            background: 'var(--surface-hover)',
            color: 'var(--text-secondary)',
            fontWeight: 500,
            flexShrink: 0,
          }}>
            {issue.stateName}
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{
        fontSize: 13,
        fontWeight: 500,
        color: 'var(--text-primary)',
        lineHeight: 1.35,
      }}>
        {issue.title}
      </div>

      {/* Metadata row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 11,
        color: 'var(--text-muted)',
        flexWrap: 'wrap',
      }}>
        {issue.priorityLabel && (
          <span style={{ color: priorityColor, fontWeight: 600 }}>
            {issue.priorityLabel}
          </span>
        )}
        {issue.assigneeName && <span>{issue.assigneeName}</span>}
        {issue.teamKey && <span>{issue.teamKey}</span>}
        {issue.labels && issue.labels.length > 0 && (
          <div style={{ display: 'flex', gap: 4 }}>
            {issue.labels.slice(0, 2).map(label => (
              <span key={label.id} style={{
                padding: '1px 6px',
                borderRadius: 10,
                background: `${label.color}22`,
                color: label.color,
                fontSize: 10,
                fontWeight: 500,
              }}>
                {label.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LargeCard({ issue, loading }: { issue?: LinearIssue; loading: boolean }) {
  if (loading || !issue) {
    return (
      <div style={{
        padding: '16px 18px',
        borderRadius: 10,
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <SkeletonLine width={90} height={12} />
          <SkeletonLine width={70} height={12} />
        </div>
        <SkeletonLine width="85%" height={15} />
        <SkeletonLine width="70%" height={12} />
        <SkeletonLine width="100%" height={11} />
        <SkeletonLine width="90%" height={11} />
      </div>
    );
  }

  const priorityColor = priorityColors[issue.priority];

  return (
    <div style={{
      padding: '16px 18px',
      borderRadius: 10,
      border: '1px solid var(--border-muted)',
      borderLeft: `3px solid ${priorityColor || 'var(--border-muted)'}`,
      background: 'var(--surface-subtle)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#5E6AD2', display: 'flex', alignItems: 'center' }}>
            <LinearLogo size={12} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#5E6AD2' }}>
            {issue.identifier || issue.id}
          </span>
          {issue.teamKey && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {issue.teamKey}</span>
          )}
        </div>
        {issue.stateName && (
          <span style={{
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 4,
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
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--text-primary)',
        lineHeight: 1.3,
      }}>
        {issue.title}
      </div>

      {/* Description preview */}
      {issue.description && (
        <div style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
        }}>
          {issue.description.replace(/[#*`_~]/g, '').trim()}
        </div>
      )}

      {/* Metadata */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        borderTop: '1px solid var(--border-muted)',
        paddingTop: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-muted)' }}>
          {issue.priorityLabel && (
            <span style={{ color: priorityColor, fontWeight: 600 }}>{issue.priorityLabel}</span>
          )}
          {issue.assigneeName && <span>{issue.assigneeName}</span>}
          {issue.labels && issue.labels.length > 0 && (
            <div style={{ display: 'flex', gap: 4 }}>
              {issue.labels.slice(0, 3).map(label => (
                <span key={label.id} style={{
                  padding: '1px 6px',
                  borderRadius: 10,
                  background: `${label.color}22`,
                  color: label.color,
                  fontSize: 10,
                  fontWeight: 500,
                }}>
                  {label.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function LinearFeedCard({ pathSegments, size }: FeedCardProps) {
  const issueId = pathSegments[0];

  const { data, loading } = useEntityQuery(GET_LINEAR_ISSUE, {
    variables: { id: issueId },
    skip: !issueId,
  });

  const issue = data?.linearIssue as LinearIssue | undefined;

  if (!issueId) {
    return (
      <div style={{
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        fontSize: 12,
        color: 'var(--text-muted)',
      }}>
        Invalid issue URI
      </div>
    );
  }

  if (size === 'small') return <SmallCard issue={issue} loading={loading} />;
  if (size === 'large' || size === 'full') return <LargeCard issue={issue} loading={loading} />;
  return <MediumCard issue={issue} loading={loading} />;
}
