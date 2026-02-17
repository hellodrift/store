import { NavSection, NavItem, NavSettingsButton, NavHeaderActions } from '@drift/ui/components';
import { useEntityQuery, gql, logger, useEntityDrawer, useEntitySelection, buildEntityURI } from '@drift/plugin-api';
import { useGithubSettings } from './useGithubSettings';

const GET_MY_PRS = gql`
  query GetMyPRs($filter: String, $state: String, $limit: Int) {
    githubMyPRs(filter: $filter, state: $state, limit: $limit) {
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
      url
    }
  }
`;

const GET_WORKFLOW_RUNS = gql`
  query GetWorkflowRuns($owner: String!, $repo: String!, $branch: String, $limit: Int) {
    githubWorkflowRuns(owner: $owner, repo: $repo, branch: $branch, limit: $limit) {
      id
      title
      owner
      repo
      runId
      workflowName
      status
      conclusion
      branch
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
  url?: string;
}

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
  url?: string;
}

const reviewStateColors: Record<string, string> = {
  approved: 'var(--status-success, #46a758)',
  changes_requested: 'var(--status-error, #e5484d)',
  pending: 'var(--status-warning, #e5933a)',
  none: 'var(--text-muted, #6e6f78)',
};

const conclusionColors: Record<string, string> = {
  success: 'var(--status-success, #46a758)',
  failure: 'var(--status-error, #e5484d)',
  cancelled: 'var(--text-muted, #6e6f78)',
  skipped: 'var(--text-muted, #6e6f78)',
  neutral: 'var(--text-secondary, #8b8d98)',
};

function PRNavItem({ pr, onSelect }: { pr: GithubPR; onSelect: () => void }) {
  const dotColor = reviewStateColors[pr.reviewState ?? 'none'] ?? 'var(--text-muted)';

  return (
    <NavItem
      key={pr.id}
      item={{
        id: pr.id,
        label: pr.title || '(No title)',
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
            <span>#{pr.number}</span>
            <span style={{ color: 'var(--text-muted)' }}>{pr.owner}/{pr.repo}</span>
          </span>
        ),
      }}
      onSelect={onSelect}
    />
  );
}

function WorkflowRunNavItem({ run, onSelect }: { run: WorkflowRun; onSelect: () => void }) {
  const isInProgress = run.status === 'in_progress' || run.status === 'queued';
  const dotColor = isInProgress
    ? 'var(--status-warning, #e5933a)'
    : conclusionColors[run.conclusion ?? ''] ?? 'var(--text-muted)';

  return (
    <NavItem
      key={run.id}
      item={{
        id: run.id,
        label: run.workflowName || run.title,
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
            <span>{run.branch}</span>
          </span>
        ),
      }}
      onSelect={onSelect}
    />
  );
}

export default function GithubNav() {
  const [settings] = useGithubSettings();
  const { select } = useEntitySelection();
  const { openEntityDrawer } = useEntityDrawer();

  // PRs query
  const { data: prData, loading: prLoading, error: prError } = useEntityQuery(GET_MY_PRS, {
    variables: {
      filter: settings.prFilter,
      state: settings.prState,
      limit: settings.limit,
    },
  });

  const prs: GithubPR[] = prData?.githubMyPRs ?? [];

  // CI/CD query — only if repos are configured
  const firstRepo = settings.repos[0];
  const [ciOwner, ciRepo] = firstRepo ? firstRepo.split('/') : ['', ''];

  const { data: ciData, loading: ciLoading, error: ciError } = useEntityQuery(GET_WORKFLOW_RUNS, {
    variables: {
      owner: ciOwner,
      repo: ciRepo,
      branch: settings.ciBranch || undefined,
      limit: settings.limit,
    },
    skip: !ciOwner || !ciRepo,
  });

  let workflowRuns: WorkflowRun[] = ciData?.githubWorkflowRuns ?? [];
  if (settings.ciFailuresOnly) {
    workflowRuns = workflowRuns.filter((r) => r.conclusion === 'failure');
  }

  if (prError && !prData) {
    logger.error('Failed to load GitHub PRs', { error: prError.message });
  }
  if (ciError && !ciData) {
    logger.error('Failed to load GitHub workflow runs', { error: ciError.message });
  }

  const handlePRSelect = (pr: GithubPR) => {
    logger.info('GitHub PR selected', { owner: pr.owner, repo: pr.repo, number: pr.number });
    openEntityDrawer(buildEntityURI('github_pr', `${pr.owner}/${pr.repo}/${pr.number}`, pr.title));
  };

  const handleWorkflowSelect = (run: WorkflowRun) => {
    logger.info('GitHub workflow run selected', { owner: run.owner, repo: run.repo, runId: run.runId });
    openEntityDrawer(buildEntityURI('github_workflow_run', `${run.owner}/${run.repo}/${run.runId}`, run.title));
  };

  const prSection = {
    id: 'github-prs',
    label: `Pull Requests${prs.length ? ` (${prs.length})` : ''}`,
    icon: <span style={{ fontSize: '12px' }}>{'🔀'}</span>,
    items: [],
    isLoading: prLoading && !prData,
    emptyState: prError && !prData ? prError.message : 'No PRs found',
    hoverActions: (
      <NavHeaderActions>
        <NavSettingsButton
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            select({ id: 'settings', type: 'drawer', data: {} });
          }}
          ariaLabel="GitHub settings"
        />
      </NavHeaderActions>
    ),
  };

  const ciSection = {
    id: 'github-ci',
    label: `CI/CD${workflowRuns.length ? ` (${workflowRuns.length})` : ''}`,
    icon: <span style={{ fontSize: '12px' }}>{'⚙️'}</span>,
    items: [],
    isLoading: ciLoading && !ciData,
    emptyState: !ciOwner ? 'Configure repos in settings' : (ciError && !ciData ? ciError.message : 'No workflow runs'),
  };

  return (
    <>
      <NavSection section={prSection}>
        {prs.map((pr) => (
          <PRNavItem key={pr.id} pr={pr} onSelect={() => handlePRSelect(pr)} />
        ))}
      </NavSection>
      {(ciOwner && ciRepo) && (
        <NavSection section={ciSection}>
          {workflowRuns.map((run) => (
            <WorkflowRunNavItem key={run.id} run={run} onSelect={() => handleWorkflowSelect(run)} />
          ))}
        </NavSection>
      )}
    </>
  );
}
