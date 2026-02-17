import { useEntityQuery, gql, logger } from '@drift/plugin-api';

const GET_WORKFLOW_RUN = gql`
  query GetWorkflowRunWidget($owner: String!, $repo: String!, $runId: Int!) {
    githubWorkflowRun(owner: $owner, repo: $repo, runId: $runId) {
      id
      title
      owner
      repo
      runId
      workflowName
      status
      conclusion
      branch
      actor
      runNumber
      url
    }
  }
`;

interface WorkflowRun {
  id: string;
  title: string;
  owner: string;
  repo: string;
  runId: number;
  workflowName?: string;
  status?: string;
  conclusion?: string;
  branch?: string;
  actor?: string;
  runNumber?: number;
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

const conclusionColors: Record<string, string> = {
  success: '#238636',
  failure: '#e5484d',
  cancelled: '#6e6f78',
  skipped: '#6e6f78',
  neutral: '#8b8d98',
};

function WorkflowRunChip({
  run,
  loading,
  label,
}: {
  run?: WorkflowRun;
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

  if (!run) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '1px 6px', borderRadius: '4px', fontSize: '12px',
        background: 'var(--surface-subtle)', color: 'var(--text-muted)',
      }}>
        {label || 'Unknown run'}
      </span>
    );
  }

  const isInProgress = run.status === 'in_progress' || run.status === 'queued';
  const dotColor = isInProgress
    ? '#e5933a'
    : conclusionColors[run.conclusion ?? ''] ?? '#6e6f78';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '1px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 500,
      background: '#1f6feb', color: '#fff',
      maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
      {run.workflowName ?? 'Workflow'} #{run.runNumber}
    </span>
  );
}

function WorkflowRunCard({
  run,
  loading,
  error,
}: {
  run?: WorkflowRun;
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

  if (error || !run) {
    return (
      <div style={{
        padding: '12px 16px', borderRadius: '8px',
        border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)',
        color: 'var(--text-muted)', fontSize: '12px',
      }}>
        {error ? `Failed to load workflow run: ${error.message}` : 'Workflow run not found'}
      </div>
    );
  }

  const isInProgress = run.status === 'in_progress' || run.status === 'queued';
  const borderColor = isInProgress
    ? '#e5933a'
    : conclusionColors[run.conclusion ?? ''] ?? '#6e6f78';
  const conclusionLabel = isInProgress
    ? run.status === 'in_progress' ? 'Running' : 'Queued'
    : (run.conclusion ?? 'unknown');

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
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#1f6feb' }}>
          {run.workflowName ?? 'Workflow'} #{run.runNumber}
        </span>
        <span style={{
          fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
          background: `${borderColor}20`, color: borderColor, fontWeight: 500,
        }}>
          {conclusionLabel}
        </span>
      </div>

      {/* Metadata */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
        {run.branch && <span>{run.branch}</span>}
        {run.actor && <span>{run.actor}</span>}
        <span>{run.owner}/{run.repo}</span>
        {run.url && (
          <a
            href={run.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#1f6feb', textDecoration: 'none', marginLeft: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            Open in GitHub
          </a>
        )}
      </div>
    </div>
  );
}

export default function WorkflowRunWidget({
  uri,
  entityType,
  pathSegments,
  label,
  compact,
}: WidgetProps) {
  const owner = pathSegments[0];
  const repo = pathSegments[1];
  const runId = parseInt(pathSegments[2], 10);

  const { data, loading, error } = useEntityQuery(GET_WORKFLOW_RUN, {
    variables: { owner, repo, runId },
    skip: !owner || !repo || isNaN(runId),
  });

  const run = data?.githubWorkflowRun as WorkflowRun | undefined;

  if (error) {
    logger.error('Failed to load workflow run for widget', { owner, repo, runId, uri, error: error.message });
  }

  if (compact) {
    return <WorkflowRunChip run={run} loading={loading} label={label} />;
  }
  return <WorkflowRunCard run={run} loading={loading} error={error} />;
}
