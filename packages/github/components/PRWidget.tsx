import { useEntityQuery, gql, logger } from '@drift/plugin-api';

const GET_PR = gql`
  query GetGithubPRWidget($owner: String!, $repo: String!, $number: Int!) {
    githubPR(owner: $owner, repo: $repo, number: $number) {
      id
      title
      number
      state
      draft
      owner
      repo
      author
      reviewState
      checksStatus
      additions
      deletions
      labels { name color }
      url
    }
  }
`;

interface GithubPR {
  id: string;
  title: string;
  number: number;
  state: string;
  draft: boolean;
  owner: string;
  repo: string;
  author?: string;
  reviewState?: string;
  checksStatus?: string;
  additions?: number;
  deletions?: number;
  labels?: Array<{ name: string; color: string }>;
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

const stateColors: Record<string, string> = {
  open: '#238636',
  closed: '#e5484d',
  merged: '#8957e5',
};

const reviewDots: Record<string, string> = {
  approved: '#238636',
  changes_requested: '#e5484d',
  pending: '#e5933a',
};

function PRChip({
  pr,
  loading,
  label,
}: {
  pr?: GithubPR;
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

  if (!pr) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '1px 6px', borderRadius: '4px', fontSize: '12px',
        background: 'var(--surface-subtle)', color: 'var(--text-muted)',
      }}>
        {label || 'Unknown PR'}
      </span>
    );
  }

  const stateColor = stateColors[pr.state] ?? 'var(--text-muted)';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '1px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 500,
      background: stateColor, color: '#fff',
      maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      #{pr.number} {pr.title} — {pr.owner}/{pr.repo}
    </span>
  );
}

function PRCard({
  pr,
  loading,
  error,
}: {
  pr?: GithubPR;
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

  if (error || !pr) {
    return (
      <div style={{
        padding: '12px 16px', borderRadius: '8px',
        border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)',
        color: 'var(--text-muted)', fontSize: '12px',
      }}>
        {error ? `Failed to load PR: ${error.message}` : 'PR not found'}
      </div>
    );
  }

  const stateColor = stateColors[pr.state] ?? 'var(--text-muted)';
  const reviewDot = reviewDots[pr.reviewState ?? ''];

  return (
    <div style={{
      padding: '12px 16px', borderRadius: '8px',
      borderTop: '1px solid var(--border-muted)',
      borderRight: '1px solid var(--border-muted)',
      borderBottom: '1px solid var(--border-muted)',
      borderLeft: `3px solid ${stateColor}`,
      background: 'var(--surface-subtle)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: stateColor }}>
          #{pr.number} · {pr.owner}/{pr.repo}
        </span>
        <span style={{
          fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
          background: 'var(--surface-hover)', color: 'var(--text-secondary)', fontWeight: 500,
        }}>
          {pr.draft ? 'Draft' : pr.state}
        </span>
      </div>

      {/* Title */}
      <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '8px', lineHeight: 1.3 }}>
        {pr.title}
      </div>

      {/* Metadata */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
        {pr.author && <span>{pr.author}</span>}
        {reviewDot && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: reviewDot, display: 'inline-block' }} />
            {pr.reviewState}
          </span>
        )}
        {pr.additions !== undefined && (
          <span>
            <span style={{ color: '#238636' }}>+{pr.additions}</span>
            {' / '}
            <span style={{ color: '#e5484d' }}>-{pr.deletions}</span>
          </span>
        )}
        {pr.labels && pr.labels.length > 0 && (
          <span>{pr.labels.map((l) => l.name).join(', ')}</span>
        )}
        {pr.url && (
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#238636', textDecoration: 'none', marginLeft: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            Open in GitHub
          </a>
        )}
      </div>
    </div>
  );
}

export default function PRWidget({
  uri,
  entityType,
  pathSegments,
  label,
  compact,
}: WidgetProps) {
  const owner = pathSegments[0];
  const repo = pathSegments[1];
  const number = parseInt(pathSegments[2], 10);

  const { data, loading, error } = useEntityQuery(GET_PR, {
    variables: { owner, repo, number },
    skip: !owner || !repo || isNaN(number),
  });

  const pr = data?.githubPR as GithubPR | undefined;

  if (error) {
    logger.error('Failed to load github PR for widget', { owner, repo, number, uri, error: error.message });
  }

  if (compact) {
    return <PRChip pr={pr} loading={loading} label={label} />;
  }
  return <PRCard pr={pr} loading={loading} error={error} />;
}
