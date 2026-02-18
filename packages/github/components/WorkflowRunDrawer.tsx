import { DrawerHeaderTitle, DrawerBody, ContentSection, Button, Separator } from '@drift/ui';
import { useEntityQuery, useEntityMutation, gql, logger } from '@drift/plugin-api';
import { GitHubIcon } from '@drift/ui/components';

// ── GraphQL ──────────────────────────────────────────────────────────────────

const GET_WORKFLOW_RUN = gql`
  query GetGithubWorkflowRun($owner: String!, $repo: String!, $runId: Int!) {
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
      event
      headSha
      actor
      actorAvatar
      runNumber
      url
      createdAt
      updatedAt
    }
  }
`;

const GET_JOBS = gql`
  query GetWorkflowJobs($owner: String!, $repo: String!, $runId: Int!) {
    githubWorkflowJobs(owner: $owner, repo: $repo, runId: $runId) {
      id
      name
      status
      conclusion
      startedAt
      completedAt
      steps {
        name
        status
        conclusion
        number
      }
    }
  }
`;

const RERUN_WORKFLOW = gql`
  mutation RerunWorkflow($owner: String!, $repo: String!, $runId: Int!) {
    githubRerunWorkflow(owner: $owner, repo: $repo, runId: $runId) {
      success
      message
    }
  }
`;

// ── Types ────────────────────────────────────────────────────────────────────

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
  event?: string;
  headSha?: string;
  actor?: string;
  actorAvatar?: string;
  runNumber?: number;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface WorkflowJob {
  id: string;
  name: string;
  status: string;
  conclusion?: string;
  startedAt?: string;
  completedAt?: string;
  steps?: Array<{
    name: string;
    status: string;
    conclusion?: string;
    number: number;
  }>;
}

interface EntityDrawerProps {
  entityId: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  drawer: {
    close: () => void;
    open: (uri: string) => void;
    push: (uri: string) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const conclusionColors: Record<string, string> = {
  success: '#238636',
  failure: '#e5484d',
  cancelled: '#6e6f78',
  skipped: '#6e6f78',
  neutral: '#8b8d98',
};

const conclusionIcons: Record<string, string> = {
  success: '✓',
  failure: '✗',
  cancelled: '⊘',
  skipped: '⊘',
  neutral: '○',
};

const statusLabels: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In Progress',
  queued: 'Queued',
  requested: 'Requested',
  waiting: 'Waiting',
  pending: 'Pending',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function WorkflowRunDrawer({ entityId, pathSegments, label, drawer }: EntityDrawerProps) {
  const owner = pathSegments[0];
  const repo = pathSegments[1];
  const runId = parseInt(pathSegments[2], 10);

  const { data: runData, loading, error, refetch } = useEntityQuery(GET_WORKFLOW_RUN, {
    variables: { owner, repo, runId },
  });
  const run: WorkflowRun | undefined = runData?.githubWorkflowRun;

  const { data: jobsData } = useEntityQuery(GET_JOBS, {
    variables: { owner, repo, runId },
  });
  const jobs: WorkflowJob[] = jobsData?.githubWorkflowJobs ?? [];

  const [rerunWorkflow] = useEntityMutation(RERUN_WORKFLOW);

  const handleRerun = async () => {
    try {
      await rerunWorkflow({ variables: { owner, repo, runId } });
      refetch();
    } catch (err: any) {
      logger.error('Failed to re-run workflow', { error: err?.message });
    }
  };

  // Loading/Error states
  if (loading && !run) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? `Run #${runId}`}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
          Loading workflow run...
        </div>
      </div>
    );
  }

  if (error && !run) {
    logger.error('Failed to load workflow run', { owner, repo, runId, error: error.message });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? `Run #${runId}`}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
          Failed to load: {error.message}
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
        Workflow run not found
      </div>
    );
  }

  const conclusionColor = run.conclusion
    ? conclusionColors[run.conclusion] ?? 'var(--text-muted)'
    : 'var(--status-warning)';
  const isComplete = run.status === 'completed';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <DrawerHeaderTitle>{run.workflowName ?? 'Workflow'} #{run.runNumber}</DrawerHeaderTitle>

      <DrawerBody>

      {/* Status Header */}
      <ContentSection>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 600,
            background: conclusionColor,
            color: '#fff',
          }}>
            {isComplete
              ? (run.conclusion ?? 'unknown').charAt(0).toUpperCase() + (run.conclusion ?? 'unknown').slice(1)
              : statusLabels[run.status ?? ''] ?? run.status}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {run.owner}/{run.repo}
          </span>
        </div>
      </ContentSection>

      <Separator />

      {/* Details */}
      <ContentSection title="Details">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Branch: </span>
            <span>{run.branch}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Event: </span>
            <span>{run.event}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Commit: </span>
            <span style={{ fontFamily: 'monospace' }}>{run.headSha}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Triggered by: </span>
            <span>{run.actor}</span>
          </div>
          {run.createdAt && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Started: </span>
              <span>{new Date(run.createdAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      </ContentSection>

      {/* Jobs */}
      {jobs.length > 0 && (
        <>
          <Separator />
          <ContentSection title={`Jobs (${jobs.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {jobs.map((job) => {
                const jobColor = job.conclusion
                  ? conclusionColors[job.conclusion] ?? 'var(--text-muted)'
                  : 'var(--status-warning)';
                const jobIcon = job.conclusion
                  ? conclusionIcons[job.conclusion] ?? '○'
                  : '◎';

                return (
                  <div key={job.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                      <span style={{ color: jobColor }}>{jobIcon}</span>
                      <span>{job.name}</span>
                    </div>
                    {job.steps && job.steps.length > 0 && (
                      <div style={{ marginLeft: '16px', marginTop: '4px' }}>
                        {job.steps.map((step) => {
                          const stepColor = step.conclusion
                            ? conclusionColors[step.conclusion] ?? 'var(--text-muted)'
                            : 'var(--text-muted)';
                          const stepIcon = step.conclusion
                            ? conclusionIcons[step.conclusion] ?? '○'
                            : '○';

                          return (
                            <div
                              key={step.number}
                              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', padding: '1px 0' }}
                            >
                              <span style={{ color: stepColor }}>{stepIcon}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{step.name}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ContentSection>
        </>
      )}

      <Separator />

      {/* Actions */}
      <ContentSection title="Actions">
        <Button size="sm" variant="outline" onClick={handleRerun}>
          Re-run workflow
        </Button>
      </ContentSection>

      </DrawerBody>

      {/* Sticky footer */}
      {run.url && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 8,
            borderTop: '1px solid var(--border-muted)',
            background: 'var(--surface-page)',
          }}
        >
          <a
            href={run.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--text-muted)',
              textDecoration: 'none',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-accent, #238636)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            <GitHubIcon size={12} />
            Open in GitHub
          </a>
        </div>
      )}
    </div>
  );
}
