/**
 * github_workflow_run entity — GitHub Actions workflow runs.
 *
 * Uses the `github` integration for auth and API calls.
 * Compound URI: @drift//github_workflow_run/owner/repo/run_id
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';
import type { Octokit } from '@octokit/rest';

// ---------- Schema ----------

const githubWorkflowRunSchema = z.object({
  id: z.string(),
  type: z.literal('github_workflow_run'),
  uri: z.string(),
  title: z.string(),
  owner: z.string(),
  repo: z.string(),
  runId: z.number(),
  workflowName: z.string().optional(),
  status: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  branch: z.string().optional(),
  event: z.string().optional(),
  headSha: z.string().optional(),
  actor: z.string().optional(),
  actorAvatar: z.string().optional(),
  runNumber: z.number().optional(),
  url: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

type GithubWorkflowRun = z.infer<typeof githubWorkflowRunSchema>;

// ---------- Helpers ----------

function getClient(ctx: EntityResolverContext): Octokit | null {
  return (ctx as any).integrations?.github?.client ?? null;
}

// ---------- Entity definition ----------

const GithubWorkflowRunEntity = defineEntity({
  type: 'github_workflow_run',
  displayName: 'GitHub Workflow Run',
  description: 'A GitHub Actions workflow run',
  icon: 'play-circle',

  schema: githubWorkflowRunSchema,

  uriPath: {
    segments: ['owner', 'repo', 'runId'] as const,
    parse: (segments: string[]) => ({
      owner: segments[0],
      repo: segments[1],
      runId: segments[2],
    }),
    format: ({ owner, repo, runId }: { owner: string; repo: string; runId: string }) =>
      `${owner}/${repo}/${runId}`,
  },

  display: {
    emoji: '\u{2699}\u{FE0F}',
    colors: {
      bg: '#1f6feb',
      text: '#FFFFFF',
      border: '#388bfd',
    },
    description: 'GitHub Actions workflow runs for CI/CD monitoring',
    outputFields: [
      { key: 'workflow', label: 'Workflow', metadataPath: 'workflowName', format: 'string' },
      { key: 'status', label: 'Status', metadataPath: 'status', format: 'string' },
      { key: 'conclusion', label: 'Conclusion', metadataPath: 'conclusion', format: 'string' },
      { key: 'branch', label: 'Branch', metadataPath: 'branch', format: 'string' },
      { key: 'actor', label: 'Actor', metadataPath: 'actor', format: 'string' },
    ],
  },

  integrations: { github: 'github' },

  cache: {
    ttl: 15_000,
    maxSize: 100,
  },

  actions: [
    {
      id: 'rerun_workflow',
      label: 'Re-run',
      description: 'Re-run this workflow',
      icon: 'refresh-cw',
      scope: 'instance',
      aiHint: 'Use to re-trigger this workflow run.',
      handler: async (params: EntityActionParams<GithubWorkflowRun>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No GitHub token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const { owner, repo, runId } = params.entity;

        try {
          await client.actions.reRunWorkflow({ owner, repo, run_id: runId });
          return {
            success: true,
            message: `Re-run triggered for workflow run #${runId}`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.logger.error('Failed to re-run workflow', { error: errMsg });
          return { success: false, message: `Failed to re-run: ${errMsg}` };
        }
      },
    },
  ],

  resolve: async ({ owner, repo, runId }: { owner: string; repo: string; runId: string }, ctx) => {
    const client = getClient(ctx);
    if (!client) return null;

    const runIdNum = parseInt(runId, 10);
    ctx.logger.info('Resolving github workflow run', { owner, repo, runId: runIdNum });

    try {
      const { data: run } = await client.actions.getWorkflowRun({ owner, repo, run_id: runIdNum });

      return {
        id: `${owner}/${repo}/${run.id}`,
        type: 'github_workflow_run' as const,
        uri: `@drift//github_workflow_run/${owner}/${repo}/${run.id}`,
        title: `${run.name ?? 'Workflow'} #${run.run_number}`,
        owner,
        repo,
        runId: run.id,
        workflowName: run.name ?? undefined,
        status: run.status ?? undefined,
        conclusion: run.conclusion ?? null,
        branch: run.head_branch ?? undefined,
        event: run.event,
        headSha: run.head_sha?.slice(0, 7),
        actor: run.actor?.login,
        actorAvatar: run.actor?.avatar_url,
        runNumber: run.run_number,
        url: run.html_url,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
      };
    } catch (err) {
      ctx.logger.error('Failed to resolve github workflow run', {
        owner,
        repo,
        runId: runIdNum,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  search: async (query: string, options, ctx) => {
    const client = getClient(ctx);
    if (!client) return [];

    const limit = options?.limit ?? 20;
    ctx.logger.info('Searching github workflow runs', { query, limit });

    try {
      // Parse query for owner/repo — expected format: "owner/repo" or "owner/repo branch:main"
      const parts = query.split(/\s+/);
      const repoRef = parts[0] ?? '';
      const [owner, repo] = repoRef.includes('/') ? repoRef.split('/') : ['', ''];

      if (!owner || !repo) {
        ctx.logger.warn('Workflow run search requires owner/repo format');
        return [];
      }

      const params: Record<string, unknown> = { owner, repo, per_page: limit };
      // Check for branch filter
      const branchPart = parts.find((p) => p.startsWith('branch:'));
      if (branchPart) params.branch = branchPart.slice(7);

      const { data } = await client.actions.listWorkflowRunsForRepo(params as any);

      return data.workflow_runs.map((run) => ({
        id: `${owner}/${repo}/${run.id}`,
        type: 'github_workflow_run' as const,
        uri: `@drift//github_workflow_run/${owner}/${repo}/${run.id}`,
        title: `${run.name ?? 'Workflow'} #${run.run_number}`,
        owner,
        repo,
        runId: run.id,
        workflowName: run.name ?? undefined,
        status: run.status ?? undefined,
        conclusion: run.conclusion ?? null,
        branch: run.head_branch ?? undefined,
        event: run.event,
        headSha: run.head_sha?.slice(0, 7),
        actor: run.actor?.login,
        actorAvatar: run.actor?.avatar_url,
        runNumber: run.run_number,
        url: run.html_url,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
      }));
    } catch (err) {
      ctx.logger.error('Failed to search github workflow runs', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
});

export default GithubWorkflowRunEntity;
