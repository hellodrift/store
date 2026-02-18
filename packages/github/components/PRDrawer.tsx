import { useState } from 'react';
import { DrawerHeaderTitle, DrawerBody, ContentSection, Button, Separator, Badge, Markdown } from '@drift/ui';
import { useEntityQuery, useEntityMutation, gql, logger } from '@drift/plugin-api';
import { GitHubIcon } from '@drift/ui/components';

// ── GraphQL ──────────────────────────────────────────────────────────────────

const GET_PR = gql`
  query GetGithubPR($owner: String!, $repo: String!, $number: Int!) {
    githubPR(owner: $owner, repo: $repo, number: $number) {
      id
      title
      number
      state
      draft
      owner
      repo
      author
      authorAvatar
      headBranch
      baseBranch
      body
      additions
      deletions
      changedFiles
      reviewState
      checksStatus
      labels { name color }
      reviewers
      mergeable
      url
    }
  }
`;

const GET_REVIEWS = gql`
  query GetPRReviews($owner: String!, $repo: String!, $number: Int!) {
    githubPRReviews(owner: $owner, repo: $repo, number: $number) {
      id
      user
      state
      body
      submittedAt
    }
  }
`;

const GET_FILES = gql`
  query GetPRFiles($owner: String!, $repo: String!, $number: Int!) {
    githubPRFiles(owner: $owner, repo: $repo, number: $number) {
      filename
      status
      additions
      deletions
    }
  }
`;

const GET_COMMENTS = gql`
  query GetPRComments($owner: String!, $repo: String!, $number: Int!) {
    githubPRComments(owner: $owner, repo: $repo, number: $number) {
      id
      user
      body
      createdAt
    }
  }
`;

const GET_CHECK_RUNS = gql`
  query GetCheckRuns($owner: String!, $repo: String!, $ref: String!) {
    githubCheckRuns(owner: $owner, repo: $repo, ref: $ref) {
      id
      name
      status
      conclusion
    }
  }
`;

const MERGE_PR = gql`
  mutation MergePR($owner: String!, $repo: String!, $number: Int!, $mergeMethod: String) {
    githubMergePR(owner: $owner, repo: $repo, number: $number, mergeMethod: $mergeMethod) {
      success
      message
    }
  }
`;

const SUBMIT_REVIEW = gql`
  mutation SubmitReview($owner: String!, $repo: String!, $number: Int!, $event: String!, $body: String) {
    githubSubmitReview(owner: $owner, repo: $repo, number: $number, event: $event, body: $body) {
      success
      message
    }
  }
`;

const ADD_COMMENT = gql`
  mutation AddPRComment($owner: String!, $repo: String!, $number: Int!, $body: String!) {
    githubAddPRComment(owner: $owner, repo: $repo, number: $number, body: $body) {
      success
      message
    }
  }
`;

// ── Types ────────────────────────────────────────────────────────────────────

interface GithubPR {
  id: string;
  title: string;
  number: number;
  state: string;
  draft: boolean;
  owner: string;
  repo: string;
  author?: string;
  authorAvatar?: string;
  headBranch?: string;
  baseBranch?: string;
  body?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  reviewState?: string;
  checksStatus?: string;
  labels?: Array<{ name: string; color: string }>;
  reviewers?: string[];
  mergeable?: boolean;
  url?: string;
}

interface Review {
  id: string;
  user?: string;
  state: string;
  body?: string;
  submittedAt?: string;
}

interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

interface Comment {
  id: string;
  user?: string;
  body?: string;
  createdAt?: string;
}

interface CheckRun {
  id: string;
  name: string;
  status: string;
  conclusion?: string;
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

const stateColors: Record<string, string> = {
  open: '#238636',
  closed: '#e5484d',
  merged: '#8957e5',
};

const reviewStateLabels: Record<string, string> = {
  approved: 'Approved',
  changes_requested: 'Changes Requested',
  pending: 'Pending Review',
  none: 'No Reviews',
};

const checksStatusLabels: Record<string, string> = {
  success: 'Passing',
  failure: 'Failing',
  pending: 'In Progress',
  neutral: 'Neutral',
  none: 'No Checks',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function PRDrawer({ entityId, pathSegments, label, drawer }: EntityDrawerProps) {
  const owner = pathSegments[0];
  const repo = pathSegments[1];
  const number = parseInt(pathSegments[2], 10);

  const [commentText, setCommentText] = useState('');
  const [reviewBody, setReviewBody] = useState('');

  // Queries
  const { data: prData, loading, error, refetch: refetchPR } = useEntityQuery(GET_PR, {
    variables: { owner, repo, number },
  });
  const pr: GithubPR | undefined = prData?.githubPR;

  const { data: reviewsData, refetch: refetchReviews } = useEntityQuery(GET_REVIEWS, {
    variables: { owner, repo, number },
  });
  const reviews: Review[] = reviewsData?.githubPRReviews ?? [];

  const { data: filesData } = useEntityQuery(GET_FILES, {
    variables: { owner, repo, number },
  });
  const files: PRFile[] = filesData?.githubPRFiles ?? [];

  const { data: commentsData, refetch: refetchComments } = useEntityQuery(GET_COMMENTS, {
    variables: { owner, repo, number },
  });
  const comments: Comment[] = commentsData?.githubPRComments ?? [];

  const { data: checksData } = useEntityQuery(GET_CHECK_RUNS, {
    variables: { owner, repo, ref: pr?.headBranch ?? '' },
    skip: !pr?.headBranch,
  });
  const checkRuns: CheckRun[] = checksData?.githubCheckRuns ?? [];

  // Mutations
  const [mergePR] = useEntityMutation(MERGE_PR);
  const [submitReview] = useEntityMutation(SUBMIT_REVIEW);
  const [addComment] = useEntityMutation(ADD_COMMENT);

  // Handlers
  const handleMerge = async (method: string) => {
    try {
      await mergePR({ variables: { owner, repo, number, mergeMethod: method } });
      refetchPR();
    } catch (err: any) {
      logger.error('Failed to merge PR', { error: err?.message });
    }
  };

  const handleSubmitReview = async (event: string) => {
    try {
      await submitReview({ variables: { owner, repo, number, event, body: reviewBody } });
      setReviewBody('');
      refetchReviews();
      refetchPR();
    } catch (err: any) {
      logger.error('Failed to submit review', { error: err?.message });
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    try {
      await addComment({ variables: { owner, repo, number, body: commentText } });
      setCommentText('');
      refetchComments();
    } catch (err: any) {
      logger.error('Failed to add comment', { error: err?.message });
    }
  };

  // Loading/Error states
  if (loading && !pr) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? `PR #${number}`}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
          Loading pull request...
        </div>
      </div>
    );
  }

  if (error && !pr) {
    logger.error('Failed to load GitHub PR', { owner, repo, number, error: error.message });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? `PR #${number}`}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
          Failed to load PR: {error.message}
        </div>
      </div>
    );
  }

  if (!pr) {
    return (
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
        Pull request not found
      </div>
    );
  }

  const stateColor = stateColors[pr.state] ?? 'var(--text-muted)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <DrawerHeaderTitle>#{pr.number} {pr.title}</DrawerHeaderTitle>

      <DrawerBody>

      {/* State + Branch */}
      <ContentSection>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 600,
            background: stateColor,
            color: '#fff',
          }}>
            {pr.draft ? 'Draft' : pr.state.charAt(0).toUpperCase() + pr.state.slice(1)}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {pr.headBranch} → {pr.baseBranch}
          </span>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {pr.owner}/{pr.repo} · by {pr.author}
        </div>
      </ContentSection>

      <Separator />

      {/* Review Status + CI */}
      <ContentSection title="Status">
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Review: </span>
            <span style={{ fontWeight: 600 }}>{reviewStateLabels[pr.reviewState ?? 'none']}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>CI: </span>
            <span style={{ fontWeight: 600 }}>{checksStatusLabels[pr.checksStatus ?? 'none']}</span>
          </div>
        </div>
        {pr.additions !== undefined && (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            <span style={{ color: '#238636' }}>+{pr.additions}</span>
            {' / '}
            <span style={{ color: '#e5484d' }}>-{pr.deletions}</span>
            {' · '}
            {pr.changedFiles} files
          </div>
        )}
      </ContentSection>

      {/* Labels */}
      {pr.labels && pr.labels.length > 0 && (
        <>
          <Separator />
          <ContentSection title="Labels">
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {pr.labels.map((l) => (
                <span
                  key={l.name}
                  style={{
                    padding: '1px 6px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: 500,
                    background: `#${l.color}30`,
                    color: `#${l.color}`,
                    border: `1px solid #${l.color}50`,
                  }}
                >
                  {l.name}
                </span>
              ))}
            </div>
          </ContentSection>
        </>
      )}

      {/* Check Runs */}
      {checkRuns.length > 0 && (
        <>
          <Separator />
          <ContentSection title={`Checks (${checkRuns.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {checkRuns.map((cr) => (
                <div key={cr.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                  <span style={{
                    color: cr.conclusion === 'success' ? '#238636'
                      : cr.conclusion === 'failure' ? '#e5484d'
                      : 'var(--text-muted)',
                  }}>
                    {cr.conclusion === 'success' ? '✓' : cr.conclusion === 'failure' ? '✗' : '○'}
                  </span>
                  <span>{cr.name}</span>
                </div>
              ))}
            </div>
          </ContentSection>
        </>
      )}

      {/* Changed Files */}
      {files.length > 0 && (
        <>
          <Separator />
          <ContentSection title={`Files (${files.length})`}>
            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {files.map((f) => (
                <div key={f.filename} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '2px 0' }}>
                  <span style={{ color: '#238636', minWidth: '30px' }}>+{f.additions}</span>
                  <span style={{ color: '#e5484d', minWidth: '30px' }}>-{f.deletions}</span>
                  <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.filename}
                  </span>
                </div>
              ))}
            </div>
          </ContentSection>
        </>
      )}

      {/* Reviews */}
      {reviews.length > 0 && (
        <>
          <Separator />
          <ContentSection title="Reviews">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {reviews.filter((r) => r.state !== 'PENDING').map((r) => (
                <div key={r.id} style={{ fontSize: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontWeight: 600 }}>{r.user}</span>
                    <span style={{
                      padding: '1px 4px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      background: r.state === 'APPROVED' ? '#23863620' : r.state === 'CHANGES_REQUESTED' ? '#e5484d20' : 'var(--surface-subtle)',
                      color: r.state === 'APPROVED' ? '#238636' : r.state === 'CHANGES_REQUESTED' ? '#e5484d' : 'var(--text-muted)',
                    }}>
                      {r.state.replace('_', ' ').toLowerCase()}
                    </span>
                  </div>
                  {r.body && (
                    <div style={{ marginTop: '2px' }}><Markdown content={r.body} size="sm" /></div>
                  )}
                </div>
              ))}
            </div>
          </ContentSection>
        </>
      )}

      {/* Description */}
      {pr.body && (
        <>
          <Separator />
          <ContentSection title="Description">
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <Markdown content={pr.body} size="sm" />
            </div>
          </ContentSection>
        </>
      )}

      {/* Comments */}
      {comments.length > 0 && (
        <>
          <Separator />
          <ContentSection title={`Comments (${comments.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {comments.map((c) => (
                <div key={c.id} style={{ fontSize: '12px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '2px' }}>{c.user}</div>
                  {c.body && <Markdown content={c.body} size="sm" />}
                </div>
              ))}
            </div>
          </ContentSection>
        </>
      )}

      <Separator />

      {/* Submit Review */}
      {pr.state === 'open' && (
        <ContentSection title="Submit Review">
          <textarea
            value={reviewBody}
            onChange={(e) => setReviewBody(e.target.value)}
            placeholder="Review comment (optional)"
            style={{
              width: '100%',
              minHeight: '60px',
              padding: '8px',
              borderRadius: '6px',
              border: '1px solid var(--border-muted)',
              background: 'var(--surface-subtle)',
              color: 'var(--text-primary)',
              fontSize: '12px',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
            <Button size="sm" variant="default" onClick={() => handleSubmitReview('APPROVE')}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleSubmitReview('REQUEST_CHANGES')}>
              Request Changes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handleSubmitReview('COMMENT')}>
              Comment
            </Button>
          </div>
        </ContentSection>
      )}

      <Separator />

      {/* Add Comment */}
      <ContentSection title="Add Comment">
        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Write a comment..."
          style={{
            width: '100%',
            minHeight: '60px',
            padding: '8px',
            borderRadius: '6px',
            border: '1px solid var(--border-muted)',
            background: 'var(--surface-subtle)',
            color: 'var(--text-primary)',
            fontSize: '12px',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <Button size="sm" onClick={handleAddComment} style={{ marginTop: '8px' }} disabled={!commentText.trim()}>
          Comment
        </Button>
      </ContentSection>

      {/* Merge / Actions */}
      {pr.state === 'open' && (
        <>
          <Separator />
          <ContentSection title="Actions">
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              <Button size="sm" variant="default" onClick={() => handleMerge('merge')} disabled={pr.mergeable === false}>
                Merge
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleMerge('squash')} disabled={pr.mergeable === false}>
                Squash & Merge
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleMerge('rebase')} disabled={pr.mergeable === false}>
                Rebase & Merge
              </Button>
            </div>
            {pr.mergeable === false && (
              <p style={{ fontSize: '11px', color: 'var(--status-error)', marginTop: '4px' }}>
                This PR has conflicts and cannot be merged
              </p>
            )}
          </ContentSection>
        </>
      )}

      </DrawerBody>

      {/* Sticky footer */}
      {pr.url && (
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
            href={pr.url}
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
