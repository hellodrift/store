/**
 * github_pr entity — GitHub Pull Requests.
 *
 * Uses the `github` integration for auth and API calls.
 * Compound URI: @drift//github_pr/owner/repo/number
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';
import type { Octokit } from '@octokit/rest';

// ---------- Schema ----------

const githubPRSchema = z.object({
  id: z.string(),
  type: z.literal('github_pr'),
  uri: z.string(),
  title: z.string(),
  number: z.number(),
  state: z.string(),
  draft: z.boolean().optional(),
  owner: z.string(),
  repo: z.string(),
  author: z.string().optional(),
  authorAvatar: z.string().optional(),
  headBranch: z.string().optional(),
  baseBranch: z.string().optional(),
  body: z.string().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  changedFiles: z.number().optional(),
  reviewState: z.string().optional(),
  checksStatus: z.string().optional(),
  labels: z.array(z.object({ name: z.string(), color: z.string() })).optional(),
  reviewers: z.array(z.string()).optional(),
  mergeable: z.boolean().nullable().optional(),
  url: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

type GithubPR = z.infer<typeof githubPRSchema>;

// ---------- Helpers ----------

function getClient(ctx: EntityResolverContext): Octokit | null {
  return (ctx as any).integrations?.github?.client ?? null;
}

/**
 * Compute aggregate review state from reviews list.
 * Returns: 'approved', 'changes_requested', 'pending', 'commented', or 'none'
 */
function computeReviewState(reviews: Array<{ state: string; user?: { login?: string } }>): string {
  if (!reviews.length) return 'none';

  // Keep only the latest review per user
  const latestByUser = new Map<string, string>();
  for (const review of reviews) {
    const user = review.user?.login ?? 'unknown';
    const state = review.state?.toUpperCase();
    if (state === 'APPROVED' || state === 'CHANGES_REQUESTED' || state === 'DISMISSED') {
      latestByUser.set(user, state);
    }
  }

  const states = [...latestByUser.values()];
  if (states.includes('CHANGES_REQUESTED')) return 'changes_requested';
  if (states.includes('APPROVED')) return 'approved';
  return 'pending';
}

/**
 * Compute aggregate checks status from check runs.
 * Returns: 'success', 'failure', 'pending', 'neutral', or 'none'
 */
function computeChecksStatus(checkRuns: Array<{ status: string; conclusion: string | null }>): string {
  if (!checkRuns.length) return 'none';
  const hasFailure = checkRuns.some((cr) => cr.conclusion === 'failure' || cr.conclusion === 'timed_out');
  if (hasFailure) return 'failure';
  const allComplete = checkRuns.every((cr) => cr.status === 'completed');
  if (!allComplete) return 'pending';
  const hasSuccess = checkRuns.some((cr) => cr.conclusion === 'success');
  if (hasSuccess) return 'success';
  return 'neutral';
}

// ---------- Action input schemas ----------

const createPRInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  title: z.string().describe('PR title'),
  head: z.string().describe('Branch containing changes'),
  base: z.string().describe('Branch to merge into'),
  body: z.string().optional().describe('PR description'),
  draft: z.boolean().optional().describe('Create as draft'),
});

const submitReviewInput = z.object({
  event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).describe('Review action'),
  body: z.string().optional().describe('Review comment'),
});

const requestReviewInput = z.object({
  reviewers: z.array(z.string()).optional().describe('GitHub usernames'),
  team_reviewers: z.array(z.string()).optional().describe('Team slugs'),
});

const addCommentInput = z.object({
  body: z.string().describe('Comment body (markdown)'),
});

const updatePRInput = z.object({
  title: z.string().optional().describe('New title'),
  body: z.string().optional().describe('New description'),
  state: z.enum(['open', 'closed']).optional().describe('New state'),
});

const mergePRInput = z.object({
  merge_method: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge method (default merge)'),
});

// ---------- Entity definition ----------

const GithubPREntity = defineEntity({
  type: 'github_pr',
  displayName: 'GitHub Pull Request',
  description: 'A pull request from GitHub',
  icon: 'git-pull-request',

  schema: githubPRSchema,

  uriPath: {
    segments: ['owner', 'repo', 'number'] as const,
    parse: (segments: string[]) => ({
      owner: segments[0],
      repo: segments[1],
      number: segments[2],
    }),
    format: ({ owner, repo, number }: { owner: string; repo: string; number: string }) =>
      `${owner}/${repo}/${number}`,
  },

  display: {
    emoji: '\u{1F500}',
    colors: {
      bg: '#238636',
      text: '#FFFFFF',
      border: '#2ea043',
    },
    description: 'GitHub pull requests for code review and merging',
    filterDescriptions: {
      state: 'PR state (open, closed, merged)',
      author: 'PR author username',
      reviewState: 'Review status (approved, changes_requested, pending)',
    },
    outputFields: [
      { key: 'repo', label: 'Repository', metadataPath: 'repo', format: 'string' },
      { key: 'author', label: 'Author', metadataPath: 'author', format: 'string' },
      { key: 'state', label: 'State', metadataPath: 'state', format: 'string' },
      { key: 'reviewState', label: 'Review', metadataPath: 'reviewState', format: 'string' },
      { key: 'checksStatus', label: 'CI', metadataPath: 'checksStatus', format: 'string' },
    ],
  },

  integrations: { github: 'github' },

  cache: {
    ttl: 30_000,
    maxSize: 200,
  },

  actions: [
    {
      id: 'create_pr',
      label: 'Create Pull Request',
      description: 'Create a new pull request',
      icon: 'plus',
      scope: 'type',
      aiHint: 'Use when the user wants to create a new PR.',
      inputSchema: createPRInput,
      handler: async (params: EntityActionParams<GithubPR>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No GitHub token configured' };

        const input = params.input as z.infer<typeof createPRInput>;
        ctx.logger.info('Creating GitHub PR', { owner: input.owner, repo: input.repo });

        try {
          const { data: pr } = await client.pulls.create({
            owner: input.owner,
            repo: input.repo,
            title: input.title,
            head: input.head,
            base: input.base,
            body: input.body ?? '',
            draft: input.draft ?? false,
          });

          return {
            success: true,
            message: `Created PR #${pr.number}: ${pr.title}`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.logger.error('Failed to create PR', { error: errMsg });
          return { success: false, message: `Failed to create PR: ${errMsg}` };
        }
      },
    },
    {
      id: 'merge_pr',
      label: 'Merge',
      description: 'Merge this pull request',
      icon: 'git-merge',
      scope: 'instance',
      aiHint: 'Use to merge this PR. Supports merge, squash, and rebase methods.',
      inputSchema: mergePRInput,
      handler: async (params: EntityActionParams<GithubPR>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No GitHub token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof mergePRInput>;
        const { owner, repo, number } = params.entity;

        try {
          const { data } = await client.pulls.merge({
            owner,
            repo,
            pull_number: number,
            merge_method: input.merge_method ?? 'merge',
          });

          return {
            success: data.merged,
            message: data.merged ? `Merged PR #${number}` : `Failed to merge: ${data.message}`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.logger.error('Failed to merge PR', { error: errMsg });
          return { success: false, message: `Failed to merge: ${errMsg}` };
        }
      },
    },
    {
      id: 'submit_review',
      label: 'Submit Review',
      description: 'Submit a review on this PR',
      icon: 'check-circle',
      scope: 'instance',
      aiHint: 'Use to approve, request changes, or comment on this PR.',
      inputSchema: submitReviewInput,
      handler: async (params: EntityActionParams<GithubPR>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No GitHub token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof submitReviewInput>;
        const { owner, repo, number } = params.entity;

        try {
          await client.pulls.createReview({
            owner,
            repo,
            pull_number: number,
            event: input.event,
            body: input.body ?? '',
          });

          return {
            success: true,
            message: `Submitted ${input.event.toLowerCase()} review on PR #${number}`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.logger.error('Failed to submit review', { error: errMsg });
          return { success: false, message: `Failed to submit review: ${errMsg}` };
        }
      },
    },
    {
      id: 'request_review',
      label: 'Request Review',
      description: 'Request review from users or teams',
      icon: 'user-plus',
      scope: 'instance',
      aiHint: 'Use to request review from specific users or teams.',
      inputSchema: requestReviewInput,
      handler: async (params: EntityActionParams<GithubPR>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No GitHub token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof requestReviewInput>;
        const { owner, repo, number } = params.entity;

        try {
          await client.pulls.requestReviewers({
            owner,
            repo,
            pull_number: number,
            reviewers: input.reviewers ?? [],
            team_reviewers: input.team_reviewers ?? [],
          });

          return {
            success: true,
            message: `Requested review on PR #${number}`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.logger.error('Failed to request review', { error: errMsg });
          return { success: false, message: `Failed to request review: ${errMsg}` };
        }
      },
    },
    {
      id: 'add_comment',
      label: 'Add Comment',
      description: 'Add a comment to this PR',
      icon: 'message-circle',
      scope: 'instance',
      aiHint: 'Use to post a comment on this PR.',
      inputSchema: addCommentInput,
      handler: async (params: EntityActionParams<GithubPR>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No GitHub token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof addCommentInput>;
        const { owner, repo, number } = params.entity;

        try {
          await client.issues.createComment({
            owner,
            repo,
            issue_number: number,
            body: input.body,
          });

          return {
            success: true,
            message: `Added comment to PR #${number}`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.logger.error('Failed to add comment', { error: errMsg });
          return { success: false, message: `Failed to add comment: ${errMsg}` };
        }
      },
    },
    {
      id: 'update_pr',
      label: 'Update PR',
      description: 'Update this PR title, body, or state',
      icon: 'edit',
      scope: 'instance',
      aiHint: 'Use to update title, description, or close/reopen this PR.',
      inputSchema: updatePRInput,
      handler: async (params: EntityActionParams<GithubPR>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No GitHub token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof updatePRInput>;
        const { owner, repo, number } = params.entity;

        try {
          const updateParams: Record<string, unknown> = { owner, repo, pull_number: number };
          if (input.title !== undefined) updateParams.title = input.title;
          if (input.body !== undefined) updateParams.body = input.body;
          if (input.state !== undefined) updateParams.state = input.state;

          await client.pulls.update(updateParams as any);

          return {
            success: true,
            message: `Updated PR #${number}`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.logger.error('Failed to update PR', { error: errMsg });
          return { success: false, message: `Failed to update PR: ${errMsg}` };
        }
      },
    },
    {
      id: 'close_pr',
      label: 'Close PR',
      description: 'Close this pull request',
      icon: 'x-circle',
      scope: 'instance',
      aiHint: 'Use to close this PR without merging.',
      handler: async (params: EntityActionParams<GithubPR>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No GitHub token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const { owner, repo, number } = params.entity;

        try {
          await client.pulls.update({ owner, repo, pull_number: number, state: 'closed' });

          return {
            success: true,
            message: `Closed PR #${number}`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.logger.error('Failed to close PR', { error: errMsg });
          return { success: false, message: `Failed to close PR: ${errMsg}` };
        }
      },
    },
  ],

  resolve: async ({ owner, repo, number }: { owner: string; repo: string; number: string }, ctx) => {
    const client = getClient(ctx);
    if (!client) return null;

    const pullNumber = parseInt(number, 10);
    ctx.logger.info('Resolving github PR', { owner, repo, pullNumber });

    try {
      const { data: pr } = await client.pulls.get({ owner, repo, pull_number: pullNumber });

      // Fetch reviews to compute review state
      let reviewState = 'none';
      try {
        const { data: reviews } = await client.pulls.listReviews({ owner, repo, pull_number: pullNumber });
        reviewState = computeReviewState(reviews as any);
      } catch {
        // reviews fetch failed
      }

      // Fetch check runs to compute checks status
      let checksStatus = 'none';
      try {
        const { data: checks } = await client.checks.listForRef({ owner, repo, ref: pr.head.sha, per_page: 100 });
        checksStatus = computeChecksStatus(checks.check_runs as any);
      } catch {
        // checks fetch failed
      }

      return {
        id: `${owner}/${repo}/${pr.number}`,
        type: 'github_pr' as const,
        uri: `@drift//github_pr/${owner}/${repo}/${pr.number}`,
        title: pr.title,
        number: pr.number,
        state: pr.merged ? 'merged' : pr.state,
        draft: pr.draft,
        owner,
        repo,
        author: pr.user?.login,
        authorAvatar: pr.user?.avatar_url,
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        body: pr.body ?? '',
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        reviewState,
        checksStatus,
        labels: pr.labels.map((l) => ({ name: l.name ?? '', color: l.color ?? '' })),
        reviewers: pr.requested_reviewers?.map((r: any) => r.login) ?? [],
        mergeable: pr.mergeable,
        url: pr.html_url,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
      };
    } catch (err) {
      ctx.logger.error('Failed to resolve github PR', {
        owner,
        repo,
        pullNumber,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  search: async (query: string, options, ctx) => {
    const client = getClient(ctx);
    if (!client) return [];

    const limit = options?.limit ?? 20;
    ctx.logger.info('Searching github PRs', { query, limit });

    try {
      const searchQuery = query.includes('is:pr') ? query : `is:pr ${query}`;
      const { data } = await client.search.issuesAndPullRequests({
        q: searchQuery,
        sort: 'updated',
        order: 'desc',
        per_page: limit,
      });

      return data.items.map((item) => {
        const repoUrl = item.repository_url ?? '';
        const repoParts = repoUrl.split('/');
        const repoName = repoParts[repoParts.length - 1] ?? '';
        const ownerName = repoParts[repoParts.length - 2] ?? '';
        return {
          id: `${ownerName}/${repoName}/${item.number}`,
          type: 'github_pr' as const,
          uri: `@drift//github_pr/${ownerName}/${repoName}/${item.number}`,
          title: item.title,
          number: item.number,
          state: item.state,
          draft: (item as any).draft ?? false,
          owner: ownerName,
          repo: repoName,
          author: item.user?.login,
          authorAvatar: item.user?.avatar_url,
          labels: item.labels.map((l) => ({ name: l.name ?? '', color: l.color ?? '' })),
          url: item.html_url,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        };
      });
    } catch (err) {
      ctx.logger.error('Failed to search github PRs', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
});

export default GithubPREntity;
