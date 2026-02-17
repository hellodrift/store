/**
 * GitHub Integration — OAuth + Octokit client + discovery/mutation methods.
 *
 * Owns the Octokit lifecycle and exposes GitHub API operations
 * for PR workflow and CI/CD monitoring.
 */

import { z } from 'zod';
import { defineIntegration } from '@drift/entity-sdk';
import { Octokit } from '@octokit/rest';

// ---------- Input schemas ----------

const listReposInput = z.object({
  type: z.enum(['owner', 'all', 'member']).optional().describe('Filter repos by type (default "owner")'),
  sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional().describe('Sort field (default "updated")'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results (default 30)'),
});

const listPRsInput = z.object({
  owner: z.string().describe('Repository owner (user or org)'),
  repo: z.string().describe('Repository name'),
  state: z.enum(['open', 'closed', 'all']).optional().describe('PR state filter (default "open")'),
  sort: z.enum(['created', 'updated', 'popularity', 'long-running']).optional().describe('Sort field (default "created")'),
  direction: z.enum(['asc', 'desc']).optional().describe('Sort direction (default "desc")'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results (default 30)'),
});

const getPRInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().int().describe('Pull request number'),
});

const getPRDiffInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().int().describe('Pull request number'),
});

const getPRFilesInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().int().describe('Pull request number'),
});

const listPRReviewsInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().int().describe('Pull request number'),
});

const listPRCommentsInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().int().describe('Pull request number'),
});

const getPRChecksInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  ref: z.string().describe('Git ref (branch name, tag, or SHA) to get check runs for'),
});

const listWorkflowRunsInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  branch: z.string().optional().describe('Filter by branch name'),
  status: z.enum(['completed', 'action_required', 'cancelled', 'failure', 'neutral', 'skipped', 'stale', 'success', 'timed_out', 'in_progress', 'queued', 'requested', 'waiting', 'pending']).optional().describe('Filter by status'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
});

const getWorkflowRunInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  run_id: z.number().int().describe('Workflow run ID'),
});

const getWorkflowRunLogsInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  run_id: z.number().int().describe('Workflow run ID'),
});

const listMyPRsInput = z.object({
  filter: z.enum(['authored', 'review_requested', 'mentioned', 'assigned']).optional().describe('Filter type (default "authored")'),
  state: z.enum(['open', 'closed']).optional().describe('PR state (default "open")'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results (default 30)'),
});

const searchPRsInput = z.object({
  query: z.string().describe('GitHub search query (e.g., "is:open author:user repo:owner/repo")'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results (default 30)'),
});

const createPRInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  title: z.string().describe('PR title'),
  head: z.string().describe('Branch containing changes'),
  base: z.string().describe('Branch to merge into (e.g., "main")'),
  body: z.string().optional().describe('PR description (markdown)'),
  draft: z.boolean().optional().describe('Create as draft PR'),
});

const mergePRInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().int().describe('Pull request number'),
  merge_method: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge method (default "merge")'),
  commit_title: z.string().optional().describe('Custom merge commit title'),
  commit_message: z.string().optional().describe('Custom merge commit message'),
});

const updatePRInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().int().describe('Pull request number'),
  title: z.string().optional().describe('New title'),
  body: z.string().optional().describe('New description'),
  state: z.enum(['open', 'closed']).optional().describe('New state'),
  base: z.string().optional().describe('New base branch'),
});

const requestReviewInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().int().describe('Pull request number'),
  reviewers: z.array(z.string()).optional().describe('GitHub usernames to request review from'),
  team_reviewers: z.array(z.string()).optional().describe('Team slugs to request review from'),
});

const submitReviewInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().int().describe('Pull request number'),
  event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).describe('Review action'),
  body: z.string().optional().describe('Review comment body'),
});

const addPRCommentInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  issue_number: z.number().int().describe('Pull request number (PRs are issues)'),
  body: z.string().describe('Comment body (markdown)'),
});

const rerunWorkflowInput = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  run_id: z.number().int().describe('Workflow run ID to re-run'),
});

// ---------- Integration definition ----------

export const githubIntegration = defineIntegration<Octokit>({
  id: 'github',
  displayName: 'GitHub',
  description: 'GitHub API for PRs, code review, and CI/CD',
  icon: 'github',

  oauth: {
    providers: [{
      providerId: 'github',
      displayName: 'GitHub',
      icon: 'github',
      required: false,
      flow: {
        grantType: 'authorization_code',
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo', 'read:org', 'workflow', 'read:user'],
        clientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? '',
        clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
        callbackPort: 5764,
      },
    }],
  },

  secureKeys: ['personal_access_token'],

  createClient: async (ctx) => {
    // Try OAuth first
    if (ctx.oauth) {
      const token = await ctx.oauth.getAccessToken('github');
      if (token) return new Octokit({ auth: token });
    }
    // Fallback to PAT
    const pat = await ctx.storage.get('personal_access_token');
    if (pat) return new Octokit({ auth: pat });

    ctx.logger.warn('No GitHub token configured');
    return null;
  },

  methods: [
    // ────────────────────────── Discovery methods ──────────────────────────

    {
      id: 'list_repos',
      description: 'List repositories for the authenticated user',
      aiHint: 'Use to discover repos the user has access to. Returns repo owner, name, description, language, and visibility.',
      inputSchema: listReposInput,
      handler: async (client, input) => {
        const { type, sort, limit } = input as z.infer<typeof listReposInput>;
        const { data } = await client.repos.listForAuthenticatedUser({
          type: type ?? 'owner',
          sort: sort ?? 'updated',
          per_page: limit ?? 30,
        });
        return {
          repos: data.map((r) => ({
            owner: r.owner.login,
            name: r.name,
            fullName: r.full_name,
            description: r.description,
            language: r.language,
            private: r.private,
            defaultBranch: r.default_branch,
            updatedAt: r.updated_at,
            url: r.html_url,
          })),
        };
      },
    },
    {
      id: 'list_prs',
      description: 'List pull requests for a repository',
      aiHint: 'Use to get PRs for a specific repo. Returns PR number, title, state, author, branches, and labels.',
      inputSchema: listPRsInput,
      handler: async (client, input) => {
        const { owner, repo, state, sort, direction, limit } = input as z.infer<typeof listPRsInput>;
        const { data } = await client.pulls.list({
          owner,
          repo,
          state: state ?? 'open',
          sort: sort ?? 'created',
          direction: direction ?? 'desc',
          per_page: limit ?? 30,
        });
        return {
          prs: data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            draft: pr.draft,
            author: pr.user?.login,
            authorAvatar: pr.user?.avatar_url,
            headBranch: pr.head.ref,
            baseBranch: pr.base.ref,
            labels: pr.labels.map((l) => ({ name: l.name ?? '', color: l.color ?? '' })),
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            url: pr.html_url,
          })),
        };
      },
    },
    {
      id: 'get_pr',
      description: 'Get detailed information about a specific pull request',
      aiHint: 'Use to get full PR details including body, additions, deletions, mergeable status, and review state.',
      inputSchema: getPRInput,
      handler: async (client, input) => {
        const { owner, repo, pull_number } = input as z.infer<typeof getPRInput>;
        const { data: pr } = await client.pulls.get({ owner, repo, pull_number });
        return {
          number: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft,
          author: pr.user?.login,
          authorAvatar: pr.user?.avatar_url,
          headBranch: pr.head.ref,
          baseBranch: pr.base.ref,
          body: pr.body,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changed_files,
          mergeable: pr.mergeable,
          mergeableState: pr.mergeable_state,
          labels: pr.labels.map((l) => ({ name: l.name ?? '', color: l.color ?? '' })),
          reviewers: pr.requested_reviewers?.map((r: any) => r.login) ?? [],
          url: pr.html_url,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
        };
      },
    },
    {
      id: 'get_pr_diff',
      description: 'Get the diff for a pull request',
      aiHint: 'Use to see the actual code changes in a PR. Returns the unified diff text.',
      inputSchema: getPRDiffInput,
      handler: async (client, input) => {
        const { owner, repo, pull_number } = input as z.infer<typeof getPRDiffInput>;
        const { data } = await client.pulls.get({
          owner,
          repo,
          pull_number,
          mediaType: { format: 'diff' },
        });
        return { diff: data as unknown as string };
      },
    },
    {
      id: 'get_pr_files',
      description: 'List files changed in a pull request',
      aiHint: 'Use to see which files were modified, added, or removed in a PR.',
      inputSchema: getPRFilesInput,
      handler: async (client, input) => {
        const { owner, repo, pull_number } = input as z.infer<typeof getPRFilesInput>;
        const { data } = await client.pulls.listFiles({ owner, repo, pull_number, per_page: 100 });
        return {
          files: data.map((f) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            changes: f.changes,
            patch: f.patch,
          })),
        };
      },
    },
    {
      id: 'list_pr_reviews',
      description: 'List reviews on a pull request',
      aiHint: 'Use to see review decisions (approved, changes_requested, commented) on a PR.',
      inputSchema: listPRReviewsInput,
      handler: async (client, input) => {
        const { owner, repo, pull_number } = input as z.infer<typeof listPRReviewsInput>;
        const { data } = await client.pulls.listReviews({ owner, repo, pull_number });
        return {
          reviews: data.map((r) => ({
            id: r.id,
            user: r.user?.login,
            state: r.state,
            body: r.body,
            submittedAt: r.submitted_at,
            url: r.html_url,
          })),
        };
      },
    },
    {
      id: 'list_pr_comments',
      description: 'List comments on a pull request (issue comments)',
      aiHint: 'Use to read the conversation on a PR. Returns comment body, author, and timestamps.',
      inputSchema: listPRCommentsInput,
      handler: async (client, input) => {
        const { owner, repo, pull_number } = input as z.infer<typeof listPRCommentsInput>;
        const { data } = await client.issues.listComments({
          owner,
          repo,
          issue_number: pull_number,
          per_page: 100,
        });
        return {
          comments: data.map((c) => ({
            id: c.id,
            user: c.user?.login,
            userAvatar: c.user?.avatar_url,
            body: c.body,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
            url: c.html_url,
          })),
        };
      },
    },
    {
      id: 'get_pr_checks',
      description: 'Get CI check runs for a git ref (branch or SHA)',
      aiHint: 'Use to see CI/CD status for a branch or commit. Returns check run names, status, conclusion.',
      inputSchema: getPRChecksInput,
      handler: async (client, input) => {
        const { owner, repo, ref } = input as z.infer<typeof getPRChecksInput>;
        const { data } = await client.checks.listForRef({ owner, repo, ref, per_page: 100 });
        return {
          totalCount: data.total_count,
          checkRuns: data.check_runs.map((cr) => ({
            id: cr.id,
            name: cr.name,
            status: cr.status,
            conclusion: cr.conclusion,
            startedAt: cr.started_at,
            completedAt: cr.completed_at,
            url: cr.html_url,
          })),
        };
      },
    },
    {
      id: 'list_workflow_runs',
      description: 'List recent workflow runs for a repository',
      aiHint: 'Use to see CI/CD pipeline runs. Returns workflow name, status, conclusion, branch, actor.',
      inputSchema: listWorkflowRunsInput,
      handler: async (client, input) => {
        const { owner, repo, branch, status, limit } = input as z.infer<typeof listWorkflowRunsInput>;
        const params: Record<string, unknown> = { owner, repo, per_page: limit ?? 20 };
        if (branch) params.branch = branch;
        if (status) params.status = status;
        const { data } = await client.actions.listWorkflowRunsForRepo(params as any);
        return {
          totalCount: data.total_count,
          runs: data.workflow_runs.map((run) => ({
            id: run.id,
            workflowName: run.name,
            status: run.status,
            conclusion: run.conclusion,
            branch: run.head_branch,
            event: run.event,
            headSha: run.head_sha?.slice(0, 7),
            actor: run.actor?.login,
            actorAvatar: run.actor?.avatar_url,
            runNumber: run.run_number,
            url: run.html_url,
            createdAt: run.created_at,
            updatedAt: run.updated_at,
          })),
        };
      },
    },
    {
      id: 'get_workflow_run',
      description: 'Get details of a specific workflow run',
      aiHint: 'Use to get full details of a workflow run including jobs.',
      inputSchema: getWorkflowRunInput,
      handler: async (client, input) => {
        const { owner, repo, run_id } = input as z.infer<typeof getWorkflowRunInput>;
        const { data: run } = await client.actions.getWorkflowRun({ owner, repo, run_id });
        const { data: jobsData } = await client.actions.listJobsForWorkflowRun({ owner, repo, run_id });
        return {
          id: run.id,
          workflowName: run.name,
          status: run.status,
          conclusion: run.conclusion,
          branch: run.head_branch,
          event: run.event,
          headSha: run.head_sha?.slice(0, 7),
          actor: run.actor?.login,
          actorAvatar: run.actor?.avatar_url,
          runNumber: run.run_number,
          url: run.html_url,
          createdAt: run.created_at,
          updatedAt: run.updated_at,
          jobs: jobsData.jobs.map((j) => ({
            id: j.id,
            name: j.name,
            status: j.status,
            conclusion: j.conclusion,
            startedAt: j.started_at,
            completedAt: j.completed_at,
            steps: j.steps?.map((s) => ({
              name: s.name,
              status: s.status,
              conclusion: s.conclusion,
              number: s.number,
            })),
          })),
        };
      },
    },
    {
      id: 'get_workflow_run_logs',
      description: 'Get download URL for workflow run logs',
      aiHint: 'Use to get the logs download URL for a workflow run. Returns a URL to download the log archive.',
      inputSchema: getWorkflowRunLogsInput,
      handler: async (client, input) => {
        const { owner, repo, run_id } = input as z.infer<typeof getWorkflowRunLogsInput>;
        const { url } = await client.actions.downloadWorkflowRunLogs({ owner, repo, run_id });
        return { logsUrl: url };
      },
    },
    {
      id: 'list_my_prs',
      description: 'List pull requests related to the authenticated user',
      aiHint: 'Use to find PRs the user authored, was requested to review, was mentioned in, or is assigned to. Call this to answer "what are my open PRs?" or "what PRs need my review?"',
      inputSchema: listMyPRsInput,
      handler: async (client, input) => {
        const { filter, state, limit } = input as z.infer<typeof listMyPRsInput>;
        const filterType = filter ?? 'authored';
        const prState = state ?? 'open';
        const maxResults = limit ?? 30;

        // Get authenticated user
        const { data: user } = await client.users.getAuthenticated();
        const username = user.login;

        let query = `is:pr is:${prState}`;
        switch (filterType) {
          case 'authored':
            query += ` author:${username}`;
            break;
          case 'review_requested':
            query += ` review-requested:${username}`;
            break;
          case 'mentioned':
            query += ` mentions:${username}`;
            break;
          case 'assigned':
            query += ` assignee:${username}`;
            break;
        }

        const { data } = await client.search.issuesAndPullRequests({
          q: query,
          sort: 'updated',
          order: 'desc',
          per_page: maxResults,
        });

        return {
          totalCount: data.total_count,
          prs: data.items.map((item) => {
            // Extract owner/repo from repository_url
            const repoUrl = item.repository_url ?? '';
            const repoParts = repoUrl.split('/');
            const repo = repoParts[repoParts.length - 1] ?? '';
            const owner = repoParts[repoParts.length - 2] ?? '';
            return {
              number: item.number,
              title: item.title,
              state: item.state,
              draft: (item as any).draft ?? false,
              author: item.user?.login,
              authorAvatar: item.user?.avatar_url,
              owner,
              repo,
              labels: item.labels.map((l) => ({ name: l.name ?? '', color: l.color ?? '' })),
              createdAt: item.created_at,
              updatedAt: item.updated_at,
              url: item.html_url,
            };
          }),
        };
      },
    },
    {
      id: 'search_prs',
      description: 'Search pull requests using GitHub search syntax',
      aiHint: 'Use for advanced PR searches. Pass a full GitHub search query like "is:open repo:owner/repo label:bug".',
      inputSchema: searchPRsInput,
      handler: async (client, input) => {
        const { query, limit } = input as z.infer<typeof searchPRsInput>;
        const searchQuery = query.includes('is:pr') ? query : `is:pr ${query}`;
        const { data } = await client.search.issuesAndPullRequests({
          q: searchQuery,
          sort: 'updated',
          order: 'desc',
          per_page: limit ?? 30,
        });
        return {
          totalCount: data.total_count,
          prs: data.items.map((item) => {
            const repoUrl = item.repository_url ?? '';
            const repoParts = repoUrl.split('/');
            const repo = repoParts[repoParts.length - 1] ?? '';
            const owner = repoParts[repoParts.length - 2] ?? '';
            return {
              number: item.number,
              title: item.title,
              state: item.state,
              draft: (item as any).draft ?? false,
              author: item.user?.login,
              authorAvatar: item.user?.avatar_url,
              owner,
              repo,
              labels: item.labels.map((l) => ({ name: l.name ?? '', color: l.color ?? '' })),
              createdAt: item.created_at,
              updatedAt: item.updated_at,
              url: item.html_url,
            };
          }),
        };
      },
    },

    // ────────────────────────── Mutation methods ──────────────────────────

    {
      id: 'create_pr',
      description: 'Create a new pull request',
      aiHint: 'Use when the user wants to create a PR. Requires owner, repo, title, head branch, and base branch.',
      inputSchema: createPRInput,
      mutation: true,
      handler: async (client, input) => {
        const { owner, repo, title, head, base, body, draft } = input as z.infer<typeof createPRInput>;
        const { data: pr } = await client.pulls.create({
          owner,
          repo,
          title,
          head,
          base,
          body: body ?? '',
          draft: draft ?? false,
        });
        return {
          success: true,
          message: `Created PR #${pr.number}: ${pr.title}`,
          number: pr.number,
          url: pr.html_url,
        };
      },
    },
    {
      id: 'merge_pr',
      description: 'Merge a pull request',
      aiHint: 'Use to merge a PR. Supports merge, squash, and rebase methods.',
      inputSchema: mergePRInput,
      mutation: true,
      handler: async (client, input) => {
        const { owner, repo, pull_number, merge_method, commit_title, commit_message } = input as z.infer<typeof mergePRInput>;
        const { data } = await client.pulls.merge({
          owner,
          repo,
          pull_number,
          merge_method: merge_method ?? 'merge',
          commit_title,
          commit_message,
        });
        return {
          success: data.merged,
          message: data.merged ? `Merged PR #${pull_number}` : `Failed to merge: ${data.message}`,
          sha: data.sha,
        };
      },
    },
    {
      id: 'update_pr',
      description: 'Update a pull request title, body, state, or base branch',
      aiHint: 'Use to update PR properties. Can change title, description, close/reopen, or change base branch.',
      inputSchema: updatePRInput,
      mutation: true,
      handler: async (client, input) => {
        const { owner, repo, pull_number, ...updates } = input as z.infer<typeof updatePRInput>;
        const params: Record<string, unknown> = { owner, repo, pull_number };
        if (updates.title !== undefined) params.title = updates.title;
        if (updates.body !== undefined) params.body = updates.body;
        if (updates.state !== undefined) params.state = updates.state;
        if (updates.base !== undefined) params.base = updates.base;
        const { data: pr } = await client.pulls.update(params as any);
        return {
          success: true,
          message: `Updated PR #${pr.number}`,
          url: pr.html_url,
        };
      },
    },
    {
      id: 'request_review',
      description: 'Request review on a pull request',
      aiHint: 'Use to request review from specific users or teams on a PR.',
      inputSchema: requestReviewInput,
      mutation: true,
      handler: async (client, input) => {
        const { owner, repo, pull_number, reviewers, team_reviewers } = input as z.infer<typeof requestReviewInput>;
        await client.pulls.requestReviewers({
          owner,
          repo,
          pull_number,
          reviewers: reviewers ?? [],
          team_reviewers: team_reviewers ?? [],
        });
        return {
          success: true,
          message: `Requested review on PR #${pull_number}`,
        };
      },
    },
    {
      id: 'submit_review',
      description: 'Submit a review on a pull request (approve, request changes, or comment)',
      aiHint: 'Use to approve a PR, request changes, or leave a review comment. Event must be APPROVE, REQUEST_CHANGES, or COMMENT.',
      inputSchema: submitReviewInput,
      mutation: true,
      handler: async (client, input) => {
        const { owner, repo, pull_number, event, body } = input as z.infer<typeof submitReviewInput>;
        await client.pulls.createReview({
          owner,
          repo,
          pull_number,
          event,
          body: body ?? '',
        });
        return {
          success: true,
          message: `Submitted ${event.toLowerCase()} review on PR #${pull_number}`,
        };
      },
    },
    {
      id: 'add_pr_comment',
      description: 'Add a comment to a pull request',
      aiHint: 'Use to post a comment on a PR. Supports markdown.',
      inputSchema: addPRCommentInput,
      mutation: true,
      handler: async (client, input) => {
        const { owner, repo, issue_number, body } = input as z.infer<typeof addPRCommentInput>;
        const { data } = await client.issues.createComment({
          owner,
          repo,
          issue_number,
          body,
        });
        return {
          success: true,
          message: `Added comment to PR #${issue_number}`,
          commentId: data.id,
          url: data.html_url,
        };
      },
    },
    {
      id: 'rerun_workflow',
      description: 'Re-run a workflow run',
      aiHint: 'Use to re-trigger a failed or completed workflow run.',
      inputSchema: rerunWorkflowInput,
      mutation: true,
      handler: async (client, input) => {
        const { owner, repo, run_id } = input as z.infer<typeof rerunWorkflowInput>;
        await client.actions.reRunWorkflow({ owner, repo, run_id });
        return {
          success: true,
          message: `Re-run triggered for workflow run ${run_id}`,
        };
      },
    },
  ],
});

export default githubIntegration;
