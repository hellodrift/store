/**
 * GitHub GraphQL Resolvers
 *
 * Implements Query and Mutation resolvers for GithubPR and GithubWorkflowRun.
 * Uses the Octokit client via resolver context injection.
 *
 * Context shape (injected by EntitySchemaRegistry):
 *   ctx.integrations.github.client — Octokit instance
 *   ctx.logger — scoped logger
 */

// Helper: get Octokit client from context
function getClient(ctx: any): any | null {
  return ctx.integrations?.github?.client ?? null;
}

/**
 * Compute aggregate review state from reviews list.
 */
function computeReviewState(reviews: Array<{ state: string; user?: any }>): string {
  if (!reviews.length) return 'none';
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

/**
 * Convert Octokit PR response to GraphQL GithubPR shape.
 */
async function prToEntity(client: any, pr: any, owner: string, repo: string): Promise<any> {
  let reviewState = 'none';
  try {
    const { data: reviews } = await client.pulls.listReviews({ owner, repo, pull_number: pr.number });
    reviewState = computeReviewState(reviews);
  } catch {
    // reviews fetch failed
  }

  let checksStatus = 'none';
  try {
    const { data: checks } = await client.checks.listForRef({ owner, repo, ref: pr.head.sha, per_page: 100 });
    checksStatus = computeChecksStatus(checks.check_runs);
  } catch {
    // checks fetch failed
  }

  return {
    id: `${owner}/${repo}/${pr.number}`,
    type: 'github_pr',
    uri: `@drift//github_pr/${owner}/${repo}/${pr.number}`,
    title: pr.title,
    number: pr.number,
    state: pr.merged ? 'merged' : pr.state,
    draft: pr.draft ?? false,
    owner,
    repo,
    author: pr.user?.login,
    authorAvatar: pr.user?.avatar_url,
    headBranch: pr.head?.ref,
    baseBranch: pr.base?.ref,
    body: pr.body ?? '',
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    reviewState,
    checksStatus,
    labels: (pr.labels ?? []).map((l: any) => ({ name: l.name ?? '', color: l.color ?? '' })),
    reviewers: pr.requested_reviewers?.map((r: any) => r.login) ?? [],
    mergeable: pr.mergeable ?? null,
    url: pr.html_url,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
  };
}

export default {
  GithubPR: {
    linkedContext: async (parent: any, _args: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client || !parent.owner || !parent.repo || !parent.number) return null;

      try {
        const lines = [
          `## GitHub PR: ${parent.title}`,
          `- **Repository**: ${parent.owner}/${parent.repo}`,
          `- **Number**: #${parent.number}`,
          `- **State**: ${parent.state}${parent.draft ? ' (draft)' : ''}`,
          `- **Author**: ${parent.author ?? 'Unknown'}`,
          `- **Branch**: ${parent.headBranch ?? '?'} → ${parent.baseBranch ?? '?'}`,
        ];

        if (parent.reviewState && parent.reviewState !== 'none') {
          lines.push(`- **Review**: ${parent.reviewState}`);
        }
        if (parent.checksStatus && parent.checksStatus !== 'none') {
          lines.push(`- **CI**: ${parent.checksStatus}`);
        }
        if (parent.additions !== undefined || parent.deletions !== undefined) {
          lines.push(`- **Changes**: +${parent.additions ?? 0} / -${parent.deletions ?? 0} (${parent.changedFiles ?? 0} files)`);
        }
        if (parent.labels?.length) {
          lines.push(`- **Labels**: ${parent.labels.map((l: any) => l.name).join(', ')}`);
        }
        if (parent.body) {
          lines.push('', '### Description', parent.body);
        }

        return lines.join('\n');
      } catch (err: any) {
        ctx.logger.error('Failed to resolve linkedContext for GithubPR', {
          owner: parent.owner,
          repo: parent.repo,
          number: parent.number,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },
  },

  Query: {
    githubRepos: async (
      _: unknown,
      { limit }: { limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const { data } = await client.repos.listForAuthenticatedUser({
          type: 'owner',
          sort: 'updated',
          per_page: limit ?? 100,
        });
        return data.map((r: any) => ({
          owner: r.owner.login,
          name: r.name,
          fullName: r.full_name,
          description: r.description,
          language: r.language,
          private: r.private,
          defaultBranch: r.default_branch,
          url: r.html_url,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to list repos', { error: err?.message ?? String(err) });
        return [];
      }
    },

    githubPR: async (
      _: unknown,
      { owner, repo, number }: { owner: string; repo: string; number: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return null;

      ctx.logger.info('Resolving github PR via GraphQL', { owner, repo, number });

      try {
        const { data: pr } = await client.pulls.get({ owner, repo, pull_number: number });
        return await prToEntity(client, pr, owner, repo);
      } catch (err: any) {
        ctx.logger.error('Failed to resolve github PR', {
          owner, repo, number,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },

    githubPRs: async (
      _: unknown,
      { owner, repo, state, limit }: { owner: string; repo: string; state?: string; limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      ctx.logger.info('Listing github PRs via GraphQL', { owner, repo, state, limit });

      try {
        const { data: prs } = await client.pulls.list({
          owner,
          repo,
          state: (state as any) ?? 'open',
          sort: 'updated',
          direction: 'desc',
          per_page: limit ?? 20,
        });

        return await Promise.all(prs.map((pr: any) => prToEntity(client, pr, owner, repo)));
      } catch (err: any) {
        ctx.logger.error('Failed to list github PRs', {
          owner, repo,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    githubMyPRs: async (
      _: unknown,
      { filter, state, repos, limit }: { filter?: string; state?: string; repos?: string[]; limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) {
        ctx.logger.warn('githubMyPRs: no GitHub client available');
        return [];
      }

      const filterType = filter ?? 'authored';
      const prState = state ?? 'open';
      const maxResults = limit ?? 20;

      ctx.logger.info('Searching my github PRs via GraphQL', { filter: filterType, state: prState, repos, limit: maxResults });

      // If repos are specified but empty array, no repos selected — return nothing
      if (repos && repos.length === 0) {
        return [];
      }

      try {
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

        // Scope to selected repos
        if (repos && repos.length > 0) {
          query += ' ' + repos.map((r) => `repo:${r}`).join(' ');
        }

        const { data } = await client.search.issuesAndPullRequests({
          q: query,
          sort: 'updated',
          order: 'desc',
          per_page: maxResults,
        });

        return data.items.map((item: any) => {
          const repoUrl = item.repository_url ?? '';
          const repoParts = repoUrl.split('/');
          const r = repoParts[repoParts.length - 1] ?? '';
          const o = repoParts[repoParts.length - 2] ?? '';
          return {
            id: `${o}/${r}/${item.number}`,
            type: 'github_pr',
            uri: `@drift//github_pr/${o}/${r}/${item.number}`,
            title: item.title,
            number: item.number,
            state: item.state,
            draft: item.draft ?? false,
            owner: o,
            repo: r,
            author: item.user?.login,
            authorAvatar: item.user?.avatar_url,
            labels: (item.labels ?? []).map((l: any) => ({ name: l.name ?? '', color: l.color ?? '' })),
            url: item.html_url,
            createdAt: item.created_at,
            updatedAt: item.updated_at,
          };
        });
      } catch (err: any) {
        ctx.logger.error('Failed to search my github PRs', {
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    githubPRReviews: async (
      _: unknown,
      { owner, repo, number }: { owner: string; repo: string; number: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const { data } = await client.pulls.listReviews({ owner, repo, pull_number: number });
        return data.map((r: any) => ({
          id: String(r.id),
          user: r.user?.login,
          state: r.state,
          body: r.body,
          submittedAt: r.submitted_at,
          url: r.html_url,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to list PR reviews', { error: err?.message ?? String(err) });
        return [];
      }
    },

    githubPRComments: async (
      _: unknown,
      { owner, repo, number }: { owner: string; repo: string; number: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const { data } = await client.issues.listComments({ owner, repo, issue_number: number, per_page: 100 });
        return data.map((c: any) => ({
          id: String(c.id),
          user: c.user?.login,
          userAvatar: c.user?.avatar_url,
          body: c.body,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          url: c.html_url,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to list PR comments', { error: err?.message ?? String(err) });
        return [];
      }
    },

    githubPRFiles: async (
      _: unknown,
      { owner, repo, number }: { owner: string; repo: string; number: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const { data } = await client.pulls.listFiles({ owner, repo, pull_number: number, per_page: 100 });
        return data.map((f: any) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          changes: f.changes,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to list PR files', { error: err?.message ?? String(err) });
        return [];
      }
    },

    githubCheckRuns: async (
      _: unknown,
      { owner, repo, ref }: { owner: string; repo: string; ref: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const { data } = await client.checks.listForRef({ owner, repo, ref, per_page: 100 });
        return data.check_runs.map((cr: any) => ({
          id: String(cr.id),
          name: cr.name,
          status: cr.status,
          conclusion: cr.conclusion,
          startedAt: cr.started_at,
          completedAt: cr.completed_at,
          url: cr.html_url,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to list check runs', { error: err?.message ?? String(err) });
        return [];
      }
    },

    githubWorkflowRuns: async (
      _: unknown,
      { owner, repo, branch, limit }: { owner: string; repo: string; branch?: string; limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      ctx.logger.info('Listing workflow runs via GraphQL', { owner, repo, branch, limit });

      try {
        const params: Record<string, unknown> = { owner, repo, per_page: limit ?? 20 };
        if (branch) params.branch = branch;
        const { data } = await client.actions.listWorkflowRunsForRepo(params);
        return data.workflow_runs.map((run: any) => ({
          id: `${owner}/${repo}/${run.id}`,
          type: 'github_workflow_run',
          uri: `@drift//github_workflow_run/${owner}/${repo}/${run.id}`,
          title: `${run.name ?? 'Workflow'} #${run.run_number}`,
          owner,
          repo,
          runId: run.id,
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
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to list workflow runs', { error: err?.message ?? String(err) });
        return [];
      }
    },

    githubWorkflowRun: async (
      _: unknown,
      { owner, repo, runId }: { owner: string; repo: string; runId: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return null;

      try {
        const { data: run } = await client.actions.getWorkflowRun({ owner, repo, run_id: runId });
        return {
          id: `${owner}/${repo}/${run.id}`,
          type: 'github_workflow_run',
          uri: `@drift//github_workflow_run/${owner}/${repo}/${run.id}`,
          title: `${run.name ?? 'Workflow'} #${run.run_number}`,
          owner,
          repo,
          runId: run.id,
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
        };
      } catch (err: any) {
        ctx.logger.error('Failed to get workflow run', { error: err?.message ?? String(err) });
        return null;
      }
    },

    githubWorkflowJobs: async (
      _: unknown,
      { owner, repo, runId }: { owner: string; repo: string; runId: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const { data } = await client.actions.listJobsForWorkflowRun({ owner, repo, run_id: runId });
        return data.jobs.map((j: any) => ({
          id: String(j.id),
          name: j.name,
          status: j.status,
          conclusion: j.conclusion,
          startedAt: j.started_at,
          completedAt: j.completed_at,
          steps: (j.steps ?? []).map((s: any) => ({
            name: s.name,
            status: s.status,
            conclusion: s.conclusion,
            number: s.number,
          })),
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to list workflow jobs', { error: err?.message ?? String(err) });
        return [];
      }
    },
  },

  Mutation: {
    githubMergePR: async (
      _: unknown,
      { owner, repo, number, mergeMethod }: { owner: string; repo: string; number: number; mergeMethod?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No GitHub token configured' };

      ctx.logger.info('Merging PR via GraphQL', { owner, repo, number });

      try {
        const { data } = await client.pulls.merge({
          owner,
          repo,
          pull_number: number,
          merge_method: (mergeMethod as any) ?? 'merge',
        });
        return {
          success: data.merged,
          message: data.merged ? `Merged PR #${number}` : `Failed to merge: ${data.message}`,
        };
      } catch (err: any) {
        return { success: false, message: `Failed to merge: ${err?.message ?? String(err)}` };
      }
    },

    githubSubmitReview: async (
      _: unknown,
      { owner, repo, number, event, body }: { owner: string; repo: string; number: number; event: string; body?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No GitHub token configured' };

      ctx.logger.info('Submitting review via GraphQL', { owner, repo, number, event });

      try {
        await client.pulls.createReview({
          owner,
          repo,
          pull_number: number,
          event: event as any,
          body: body ?? '',
        });
        return { success: true, message: `Submitted ${event.toLowerCase()} review on PR #${number}` };
      } catch (err: any) {
        return { success: false, message: `Failed to submit review: ${err?.message ?? String(err)}` };
      }
    },

    githubAddPRComment: async (
      _: unknown,
      { owner, repo, number, body }: { owner: string; repo: string; number: number; body: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No GitHub token configured' };

      ctx.logger.info('Adding PR comment via GraphQL', { owner, repo, number });

      try {
        await client.issues.createComment({ owner, repo, issue_number: number, body });
        return { success: true, message: `Added comment to PR #${number}` };
      } catch (err: any) {
        return { success: false, message: `Failed to add comment: ${err?.message ?? String(err)}` };
      }
    },

    githubUpdatePR: async (
      _: unknown,
      { owner, repo, number, title, body, state }: { owner: string; repo: string; number: number; title?: string; body?: string; state?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No GitHub token configured' };

      ctx.logger.info('Updating PR via GraphQL', { owner, repo, number });

      try {
        const params: Record<string, unknown> = { owner, repo, pull_number: number };
        if (title !== undefined) params.title = title;
        if (body !== undefined) params.body = body;
        if (state !== undefined) params.state = state;
        await client.pulls.update(params as any);
        return { success: true, message: `Updated PR #${number}` };
      } catch (err: any) {
        return { success: false, message: `Failed to update PR: ${err?.message ?? String(err)}` };
      }
    },

    githubRerunWorkflow: async (
      _: unknown,
      { owner, repo, runId }: { owner: string; repo: string; runId: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No GitHub token configured' };

      ctx.logger.info('Re-running workflow via GraphQL', { owner, repo, runId });

      try {
        await client.actions.reRunWorkflow({ owner, repo, run_id: runId });
        return { success: true, message: `Re-run triggered for workflow run ${runId}` };
      } catch (err: any) {
        return { success: false, message: `Failed to re-run workflow: ${err?.message ?? String(err)}` };
      }
    },
  },
};
