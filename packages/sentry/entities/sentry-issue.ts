/**
 * sentry_issue entity — Sentry error issues.
 *
 * Uses the `sentry` integration for auth and API calls.
 * URI: @drift//sentry_issue/{id} (numeric issue ID)
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';

// ---------- Schema ----------

const sentryIssueSchema = z.object({
  id: z.string(),
  type: z.literal('sentry_issue'),
  uri: z.string(),
  title: z.string(),
  shortId: z.string(),
  culprit: z.string(),
  level: z.string(),
  status: z.string(),
  substatus: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  count: z.string(),
  userCount: z.number(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  permalink: z.string(),
  project: z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    platform: z.string().nullable().optional(),
  }),
  assignedTo: z.object({
    type: z.string(),
    id: z.string(),
    name: z.string(),
    email: z.string().optional(),
  }).nullable().optional(),
  metadata: z.object({
    type: z.string().optional(),
    value: z.string().optional(),
    filename: z.string().optional(),
    function: z.string().optional(),
  }).optional(),
  isBookmarked: z.boolean().optional(),
  hasSeen: z.boolean().optional(),
});

type SentryIssue = z.infer<typeof sentryIssueSchema>;

// ---------- Helpers ----------

interface SentryClient {
  readonly token: string;
  readonly organization: string;
  readonly baseUrl: string;
  request<T>(path: string, options?: { method?: string; body?: unknown; params?: Record<string, unknown> }): Promise<T>;
}

function getClient(ctx: EntityResolverContext): SentryClient | null {
  return (ctx as any).integrations?.sentry?.client ?? null;
}

function issueToEntity(issue: any): SentryIssue {
  const id = String(issue.id);
  return {
    id,
    type: 'sentry_issue',
    uri: `@drift//sentry_issue/${id}`,
    title: issue.title ?? 'Untitled',
    shortId: issue.shortId ?? id,
    culprit: issue.culprit ?? '',
    level: issue.level ?? 'error',
    status: issue.status ?? 'unresolved',
    substatus: issue.substatus ?? null,
    platform: issue.platform ?? null,
    count: String(issue.count ?? '0'),
    userCount: issue.userCount ?? 0,
    firstSeen: issue.firstSeen ?? new Date().toISOString(),
    lastSeen: issue.lastSeen ?? new Date().toISOString(),
    permalink: issue.permalink ?? '',
    project: {
      id: String(issue.project?.id ?? ''),
      slug: issue.project?.slug ?? '',
      name: issue.project?.name ?? '',
      platform: issue.project?.platform ?? null,
    },
    assignedTo: issue.assignedTo
      ? {
          type: issue.assignedTo.type ?? 'user',
          id: String(issue.assignedTo.id ?? ''),
          name: issue.assignedTo.name ?? '',
          email: issue.assignedTo.email,
        }
      : null,
    metadata: issue.metadata
      ? {
          type: issue.metadata.type,
          value: issue.metadata.value,
          filename: issue.metadata.filename,
          function: issue.metadata.function,
        }
      : undefined,
    isBookmarked: issue.isBookmarked,
    hasSeen: issue.hasSeen,
  };
}

// ---------- Action input schemas ----------

const resolveIssueInput = z.object({
  inNextRelease: z.boolean().optional().describe('Resolve in the next release'),
  inRelease: z.string().optional().describe('Resolve in a specific release version'),
});

const ignoreIssueInput = z.object({
  ignoreDuration: z.number().optional().describe('Minutes to ignore (e.g., 30, 60, 1440)'),
  ignoreCount: z.number().optional().describe('Ignore until N more events occur'),
  ignoreUserCount: z.number().optional().describe('Ignore until N more users are affected'),
});

const assignIssueInput = z.object({
  assignedTo: z.string().describe('Assign to user or team. Format: "user:{id}" or "team:{id}". Call list_members to find valid IDs.'),
});

// ---------- Entity definition ----------

const SentryIssueEntity = defineEntity({
  type: 'sentry_issue',
  displayName: 'Sentry Issue',
  description: 'An error issue from Sentry',
  icon: 'alert-triangle',

  schema: sentryIssueSchema,

  uriPath: {
    segments: ['id'] as const,
    parse: (segments: string[]) => ({ id: segments[0] }),
    format: ({ id }: { id: string }) => id,
  },

  display: {
    emoji: '\uD83D\uDC1B',
    colors: {
      bg: '#362D59',
      text: '#FFFFFF',
      border: '#6C5FC7',
    },
    description: 'Error issues from Sentry',
    filterDescriptions: [
      { name: 'status', type: 'string', description: 'Issue status (unresolved, resolved, ignored)' },
      { name: 'level', type: 'string', description: 'Issue severity (fatal, error, warning, info)' },
      { name: 'project', type: 'string', description: 'Sentry project name' },
    ],
    outputFields: [
      { key: 'shortId', label: 'ID', metadataPath: 'shortId' },
      { key: 'level', label: 'Level', metadataPath: 'level' },
      { key: 'status', label: 'Status', metadataPath: 'status' },
      { key: 'project', label: 'Project', metadataPath: 'project.name' },
      { key: 'count', label: 'Events', metadataPath: 'count' },
      { key: 'userCount', label: 'Users', metadataPath: 'userCount' },
    ],
  },

  paletteFilters: [
    {
      key: 'status',
      label: 'Status',
      values: [
        { id: 'unresolved', label: 'Unresolved', colorToken: 'warning' },
        { id: 'resolved', label: 'Resolved', colorToken: 'success' },
        { id: 'ignored', label: 'Ignored', colorToken: 'neutral' },
      ],
    },
    {
      key: 'level',
      label: 'Level',
      values: [
        { id: 'fatal', label: 'Fatal', colorToken: 'danger' },
        { id: 'error', label: 'Error', colorToken: 'danger' },
        { id: 'warning', label: 'Warning', colorToken: 'warning' },
        { id: 'info', label: 'Info', colorToken: 'neutral' },
      ],
    },
  ],

  integrations: { sentry: 'sentry' },

  cache: {
    ttl: 30_000,
    maxSize: 200,
  },

  actions: [
    {
      id: 'resolve_issue',
      label: 'Resolve',
      description: 'Resolve this issue',
      icon: 'check-circle',
      scope: 'instance',
      aiHint: 'Use to mark this Sentry issue as resolved. Optionally resolve in a specific release.',
      inputSchema: resolveIssueInput,
      handler: async (params: EntityActionParams<SentryIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Sentry token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = (params.input ?? {}) as z.infer<typeof resolveIssueInput>;
        const body: Record<string, unknown> = { status: 'resolved' };
        if (input.inNextRelease || input.inRelease) {
          body.statusDetails = {};
          if (input.inNextRelease) (body.statusDetails as any).inNextRelease = true;
          if (input.inRelease) (body.statusDetails as any).inRelease = input.inRelease;
        }

        try {
          const issue = await client.request<any>(`/issues/${params.entity.id}/`, {
            method: 'PUT',
            body,
          });
          return { success: true, message: `Resolved ${issue.shortId}: ${issue.title}` };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { success: false, message: `Failed to resolve: ${errMsg}` };
        }
      },
    },
    {
      id: 'unresolve_issue',
      label: 'Unresolve',
      description: 'Reopen this issue',
      icon: 'rotate-ccw',
      scope: 'instance',
      aiHint: 'Use to reopen a resolved or ignored issue.',
      handler: async (params: EntityActionParams<SentryIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Sentry token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        try {
          const issue = await client.request<any>(`/issues/${params.entity.id}/`, {
            method: 'PUT',
            body: { status: 'unresolved' },
          });
          return { success: true, message: `Reopened ${issue.shortId}: ${issue.title}` };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { success: false, message: `Failed to unresolve: ${errMsg}` };
        }
      },
    },
    {
      id: 'ignore_issue',
      label: 'Ignore',
      description: 'Ignore this issue',
      icon: 'eye-off',
      scope: 'instance',
      aiHint: 'Use to ignore/snooze a Sentry issue. Optionally set duration, event count, or user count thresholds.',
      inputSchema: ignoreIssueInput,
      handler: async (params: EntityActionParams<SentryIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Sentry token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = (params.input ?? {}) as z.infer<typeof ignoreIssueInput>;
        const body: Record<string, unknown> = { status: 'ignored' };
        if (input.ignoreDuration || input.ignoreCount || input.ignoreUserCount) {
          const details: Record<string, unknown> = {};
          if (input.ignoreDuration) details.ignoreDuration = input.ignoreDuration;
          if (input.ignoreCount) details.ignoreCount = input.ignoreCount;
          if (input.ignoreUserCount) details.ignoreUserCount = input.ignoreUserCount;
          body.statusDetails = details;
        }

        try {
          const issue = await client.request<any>(`/issues/${params.entity.id}/`, {
            method: 'PUT',
            body,
          });
          return { success: true, message: `Ignored ${issue.shortId}: ${issue.title}` };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { success: false, message: `Failed to ignore: ${errMsg}` };
        }
      },
    },
    {
      id: 'assign_issue',
      label: 'Assign',
      description: 'Assign this issue to a user or team',
      icon: 'user-plus',
      scope: 'instance',
      aiHint: 'Use to assign this issue. Format: "user:{id}" or "team:{id}". Call list_members integration method first to find valid IDs.',
      inputSchema: assignIssueInput,
      handler: async (params: EntityActionParams<SentryIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Sentry token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof assignIssueInput>;

        try {
          const issue = await client.request<any>(`/issues/${params.entity.id}/`, {
            method: 'PUT',
            body: { assignedTo: input.assignedTo },
          });
          return {
            success: true,
            message: `Assigned ${issue.shortId} to ${issue.assignedTo?.name ?? input.assignedTo}`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { success: false, message: `Failed to assign: ${errMsg}` };
        }
      },
    },
    {
      id: 'unassign_issue',
      label: 'Unassign',
      description: 'Remove assignment from this issue',
      icon: 'user-minus',
      scope: 'instance',
      aiHint: 'Use to remove the current assignee from this issue.',
      handler: async (params: EntityActionParams<SentryIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Sentry token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        try {
          const issue = await client.request<any>(`/issues/${params.entity.id}/`, {
            method: 'PUT',
            body: { assignedTo: null },
          });
          return { success: true, message: `Unassigned ${issue.shortId}` };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { success: false, message: `Failed to unassign: ${errMsg}` };
        }
      },
    },
    {
      id: 'open_in_sentry',
      label: 'Open in Sentry',
      description: 'Open this issue in Sentry',
      icon: 'external-link',
      shortcut: 'mod+o',
      scope: 'instance',
      aiHint: 'Use when the user wants to view the full issue in the Sentry web UI.',
      handler: async (params: EntityActionParams<SentryIssue>): Promise<EntityActionResult> => {
        if (!params.entity?.permalink) {
          return { success: false, message: 'No permalink available' };
        }
        return {
          success: true,
          message: `Opening ${params.entity.shortId} in Sentry`,
          data: { url: params.entity.permalink },
        };
      },
    },
  ],

  resolve: async ({ id }: { id: string }, ctx: EntityResolverContext): Promise<SentryIssue | null> => {
    const client = getClient(ctx);
    if (!client) return null;

    try {
      const issue = await client.request<any>(`/issues/${id}/`);
      return issueToEntity(issue);
    } catch {
      return null;
    }
  },

  search: async (
    query: string,
    options: { limit?: number } | undefined,
    ctx: EntityResolverContext,
  ): Promise<SentryIssue[]> => {
    const client = getClient(ctx);
    if (!client) return [];

    const params: Record<string, unknown> = {
      limit: options?.limit ?? 25,
    };

    // If query looks like a short ID (e.g., PROJ-123), use shortIdLookup
    if (/^[A-Z]+-\d+$/i.test(query.trim())) {
      params.query = query.trim();
      params.shortIdLookup = '1';
    } else {
      // Prepend is:unresolved if the user didn't specify a status filter
      const q = query.trim();
      params.query = q.includes('is:') ? q : `is:unresolved ${q}`.trim();
    }

    try {
      const issues = await client.request<any[]>(
        `/organizations/${client.organization}/issues/`,
        { params },
      );
      return issues.map(issueToEntity);
    } catch {
      return [];
    }
  },
});

export default SentryIssueEntity;
