/**
 * Sentry Integration — Dual auth (OAuth + token) + REST API client + methods.
 *
 * Uses raw fetch against Sentry API v0 (https://docs.sentry.io/api/).
 * No external SDK — lightweight client with built-in rate limiting.
 */

import { z } from 'zod';
import { defineIntegration } from '@drift/entity-sdk';

// =============================================================================
// CLIENT
// =============================================================================

interface SentryClient {
  readonly token: string;
  readonly organization: string;
  readonly baseUrl: string;
  request<T>(path: string, options?: { method?: string; body?: unknown; params?: Record<string, unknown> }): Promise<T>;
}

// Simple sliding-window rate limiter (4 req/s, conservative for Sentry's 5 req/s limit)
const requestTimestamps: number[] = [];
const MAX_RPS = 4;

async function acquireRateLimit(): Promise<void> {
  const now = Date.now();
  // Remove timestamps older than 1 second
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] >= 1000) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_RPS) {
    const waitTime = 1000 - (now - requestTimestamps[0]) + 10;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
  requestTimestamps.push(Date.now());
}

function buildQueryString(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) sp.append(key, String(item));
    } else {
      sp.append(key, String(value));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

function createSentryClient(token: string, organization: string, baseUrl: string): SentryClient {
  const apiBase = `${baseUrl.replace(/\/$/, '')}/api/0`;

  return {
    token,
    organization,
    baseUrl,

    async request<T>(
      path: string,
      options?: { method?: string; body?: unknown; params?: Record<string, unknown> },
    ): Promise<T> {
      await acquireRateLimit();

      const qs = options?.params ? buildQueryString(options.params) : '';
      const url = path.startsWith('http') ? `${path}${qs}` : `${apiBase}${path}${qs}`;

      const fetchOptions: RequestInit = {
        method: options?.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      };

      if (options?.body) {
        fetchOptions.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Sentry API ${response.status}: ${errorText.slice(0, 300)}`);
      }

      if (response.status === 204) return undefined as T;
      return response.json();
    },
  };
}

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const getIssuesInput = z.object({
  query: z.string().optional().describe('Sentry search query (e.g., "is:unresolved level:error"). Defaults to "is:unresolved".'),
  project: z.array(z.number()).optional().describe('Filter by project IDs (-1 for all)'),
  sort: z.enum(['date', 'new', 'freq', 'user', 'trends', 'inbox']).optional().describe('Sort order (default "date")'),
  statsPeriod: z.string().optional().describe('Time period (e.g., "24h", "7d", "14d", "30d")'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results (default 25)'),
});

const getIssueInput = z.object({
  issueId: z.string().describe('Numeric issue ID'),
});

const getIssueByShortIdInput = z.object({
  shortId: z.string().describe('Short issue ID (e.g., "PROJ-123")'),
});

const updateIssueInput = z.object({
  issueId: z.string().describe('Numeric issue ID'),
  status: z.enum(['resolved', 'unresolved', 'ignored']).optional().describe('New issue status'),
  statusDetails: z.object({
    inRelease: z.string().optional(),
    inNextRelease: z.boolean().optional(),
    ignoreDuration: z.number().optional().describe('Minutes to ignore'),
    ignoreCount: z.number().optional().describe('Ignore until N more events'),
    ignoreUserCount: z.number().optional().describe('Ignore until N more users affected'),
  }).optional().describe('Status details (for resolve/ignore options)'),
  assignedTo: z.string().nullable().optional().describe('Assign to user/team (format: "user:123" or "team:456"), or null to unassign'),
  hasSeen: z.boolean().optional().describe('Mark as seen/unseen'),
  isBookmarked: z.boolean().optional().describe('Bookmark the issue'),
});

const bulkUpdateIssuesInput = z.object({
  issueIds: z.array(z.string()).describe('Numeric issue IDs to update'),
  status: z.enum(['resolved', 'unresolved', 'ignored']).optional().describe('New status for all issues'),
  assignedTo: z.string().nullable().optional().describe('Assign to user/team, or null to unassign'),
});

const getIssueEventsInput = z.object({
  issueId: z.string().describe('Numeric issue ID'),
  limit: z.number().int().min(1).max(100).optional().describe('Max events (default 10)'),
});

const getLatestEventInput = z.object({
  issueId: z.string().describe('Numeric issue ID'),
});

// =============================================================================
// INTEGRATION DEFINITION
// =============================================================================

export const sentryIntegration = defineIntegration<SentryClient>({
  id: 'sentry',
  displayName: 'Sentry',
  description: 'Sentry error monitoring REST API',
  icon: 'alert-triangle',

  secureKeys: ['auth_token', 'organization', 'base_url'],

  oauth: {
    providers: [
      {
        providerId: 'sentry',
        displayName: 'Sentry',
        icon: 'alert-triangle',
        required: false,
        flow: {
          grantType: 'authorization_code',
          clientId: process.env.SENTRY_OAUTH_CLIENT_ID ?? '',
          authorizationUrl: 'https://sentry.io/oauth/authorize/',
          tokenUrl: 'https://sentry.io/oauth/token/',
          scopes: ['event:read', 'event:write', 'project:read', 'org:read', 'team:read', 'member:read'],
          scopeSeparator: ' ',
          redirectPort: 5763,
          redirectPath: '/callbacks/sentry',
          pkce: { enabled: true, method: 'S256' },
        },
      },
    ],
  },

  createClient: async (ctx) => {
    let token: string | null = null;

    // 1. Prefer OAuth token
    if (ctx.oauth) {
      token = await ctx.oauth.getAccessToken('sentry');
    }

    // 2. Fall back to stored Internal Integration token
    if (!token) {
      token = await ctx.storage.get('auth_token');
    }

    if (!token) {
      ctx.logger.warn('No OAuth token or auth token configured for Sentry');
      return null;
    }

    const organization = await ctx.storage.get('organization');
    if (!organization) {
      ctx.logger.warn('No organization configured for Sentry');
      return null;
    }

    const baseUrl = (await ctx.storage.get('base_url')) || 'https://sentry.io';

    return createSentryClient(token, organization, baseUrl);
  },

  methods: [
    {
      id: 'get_viewer',
      description: 'Get organization info to verify Sentry connection',
      aiHint: 'Use to check if Sentry is connected and get organization details.',
      handler: async (client) => {
        const org = await client.request<any>(`/organizations/${client.organization}/`);
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          dateCreated: org.dateCreated,
        };
      },
    },
    {
      id: 'list_projects',
      description: 'List all Sentry projects in the organization',
      aiHint: 'Use to discover available projects. Returns project id, slug, name, and platform.',
      handler: async (client) => {
        const projects = await client.request<any[]>(`/organizations/${client.organization}/projects/`);
        return {
          projects: projects.map((p) => ({
            id: p.id,
            slug: p.slug,
            name: p.name,
            platform: p.platform,
          })),
        };
      },
    },
    {
      id: 'get_issues',
      description: 'Search and list Sentry issues with filters',
      aiHint: 'Use to find Sentry issues. Supports rich query syntax: "is:unresolved", "level:error", "assigned:me", "firstSeen:>2024-01-01". Default query is "is:unresolved".',
      inputSchema: getIssuesInput,
      handler: async (client, input) => {
        const { query, project, sort, statsPeriod, limit } = input as z.infer<typeof getIssuesInput>;
        const params: Record<string, unknown> = {
          query: query ?? 'is:unresolved',
          limit: limit ?? 25,
        };
        if (project) params.project = project;
        if (sort) params.sort = sort;
        if (statsPeriod) params.statsPeriod = statsPeriod;

        const issues = await client.request<any[]>(
          `/organizations/${client.organization}/issues/`,
          { params },
        );

        return {
          issues: issues.map((i) => ({
            id: i.id,
            shortId: i.shortId,
            title: i.title,
            culprit: i.culprit,
            level: i.level,
            status: i.status,
            count: i.count,
            userCount: i.userCount,
            firstSeen: i.firstSeen,
            lastSeen: i.lastSeen,
            project: { id: i.project.id, slug: i.project.slug, name: i.project.name },
            assignedTo: i.assignedTo,
            permalink: i.permalink,
          })),
        };
      },
    },
    {
      id: 'get_issue',
      description: 'Get a single Sentry issue by numeric ID',
      aiHint: 'Use to get full details of a specific Sentry issue by its numeric ID.',
      inputSchema: getIssueInput,
      handler: async (client, input) => {
        const { issueId } = input as z.infer<typeof getIssueInput>;
        return client.request<any>(`/issues/${issueId}/`);
      },
    },
    {
      id: 'get_issue_by_short_id',
      description: 'Get a Sentry issue by short ID (e.g., PROJ-123)',
      aiHint: 'Use when the user references an issue by short ID like "PROJ-123". Performs a search with shortIdLookup enabled.',
      inputSchema: getIssueByShortIdInput,
      handler: async (client, input) => {
        const { shortId } = input as z.infer<typeof getIssueByShortIdInput>;
        const issues = await client.request<any[]>(
          `/organizations/${client.organization}/issues/`,
          { params: { query: shortId, shortIdLookup: '1', limit: 1 } },
        );
        const match = issues.find(
          (i) => i.shortId.toLowerCase() === shortId.toLowerCase(),
        );
        return match ?? null;
      },
    },
    {
      id: 'update_issue',
      description: 'Update a Sentry issue (status, assignment, bookmark)',
      aiHint: 'Use to resolve, unresolve, ignore, assign, or bookmark a Sentry issue. For assignment, format is "user:{id}" or "team:{id}". Set assignedTo to null to unassign.',
      inputSchema: updateIssueInput,
      mutation: true,
      handler: async (client, input) => {
        const { issueId, ...update } = input as z.infer<typeof updateIssueInput>;
        const body: Record<string, unknown> = {};
        if (update.status !== undefined) body.status = update.status;
        if (update.statusDetails !== undefined) body.statusDetails = update.statusDetails;
        if (update.assignedTo !== undefined) body.assignedTo = update.assignedTo;
        if (update.hasSeen !== undefined) body.hasSeen = update.hasSeen;
        if (update.isBookmarked !== undefined) body.isBookmarked = update.isBookmarked;

        const issue = await client.request<any>(`/issues/${issueId}/`, {
          method: 'PUT',
          body,
        });

        return {
          success: true,
          message: `Updated issue ${issue.shortId}: ${issue.title}`,
          issue: {
            id: issue.id,
            shortId: issue.shortId,
            title: issue.title,
            status: issue.status,
            assignedTo: issue.assignedTo,
          },
        };
      },
    },
    {
      id: 'bulk_update_issues',
      description: 'Bulk update multiple Sentry issues',
      aiHint: 'Use to resolve, ignore, or assign multiple issues at once. Provide an array of numeric issue IDs.',
      inputSchema: bulkUpdateIssuesInput,
      mutation: true,
      handler: async (client, input) => {
        const { issueIds, status, assignedTo } = input as z.infer<typeof bulkUpdateIssuesInput>;
        const body: Record<string, unknown> = {};
        if (status !== undefined) body.status = status;
        if (assignedTo !== undefined) body.assignedTo = assignedTo;

        const qs = issueIds.map((id) => `id=${id}`).join('&');
        await client.request<unknown>(
          `/organizations/${client.organization}/issues/?${qs}`,
          { method: 'PUT', body },
        );

        return { success: true, updated: issueIds.length };
      },
    },
    {
      id: 'get_issue_events',
      description: 'Get recent events (error occurrences) for a Sentry issue',
      aiHint: 'Use to see individual error occurrences for an issue, including stack traces, tags, and user context.',
      inputSchema: getIssueEventsInput,
      handler: async (client, input) => {
        const { issueId, limit } = input as z.infer<typeof getIssueEventsInput>;
        return client.request<any[]>(`/issues/${issueId}/events/`, {
          params: { limit: limit ?? 10 },
        });
      },
    },
    {
      id: 'get_latest_event',
      description: 'Get the most recent event for a Sentry issue',
      aiHint: 'Use to inspect the latest error occurrence — includes full stack trace, tags, user info, and context.',
      inputSchema: getLatestEventInput,
      handler: async (client, input) => {
        const { issueId } = input as z.infer<typeof getLatestEventInput>;
        try {
          return await client.request<any>(`/issues/${issueId}/events/latest/`);
        } catch {
          return null;
        }
      },
    },
    {
      id: 'list_members',
      description: 'List organization members for assignment',
      aiHint: 'Use to discover org members for issue assignment. Returns user IDs needed for update_issue assignedTo field (format: "user:{id}").',
      handler: async (client) => {
        const members = await client.request<any[]>(
          `/organizations/${client.organization}/members/`,
        );
        return {
          members: members.map((m) => ({
            id: m.user?.id ?? m.id,
            name: m.user?.name ?? m.name,
            email: m.user?.email ?? m.email,
          })),
        };
      },
    },
  ],
});

export default sentryIntegration;
