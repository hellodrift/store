/**
 * Sentry GraphQL Resolvers
 *
 * Implements Query and Mutation resolvers for SentryIssue and related types.
 * Uses the Sentry client via resolver context injection.
 *
 * Context shape (injected by EntitySchemaRegistry):
 *   ctx.integrations.sentry.client — SentryClient instance
 *   ctx.logger — scoped logger
 */

// Helper: get Sentry client from context
function getClient(ctx: any): any | null {
  return ctx.integrations?.sentry?.client ?? null;
}

/**
 * Convert Sentry API issue to GraphQL SentryIssue shape.
 */
function issueToGraphQL(issue: any): any {
  return {
    id: String(issue.id),
    type: 'sentry_issue',
    uri: `@drift//sentry_issue/${issue.id}`,
    title: issue.title ?? 'Untitled',
    shortId: issue.shortId ?? String(issue.id),
    culprit: issue.culprit ?? '',
    level: issue.level ?? 'error',
    status: issue.status ?? 'unresolved',
    substatus: issue.substatus ?? null,
    platform: issue.platform ?? null,
    count: String(issue.count ?? '0'),
    userCount: issue.userCount ?? 0,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    permalink: issue.permalink ?? '',
    isBookmarked: issue.isBookmarked ?? false,
    hasSeen: issue.hasSeen ?? false,
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
      : null,
  };
}

export default {
  SentryIssue: {
    linkedContext: async (parent: any, _args: unknown, ctx: any) => {
      try {
        const lines = [
          `## Sentry Issue: ${parent.shortId}`,
          `- **Title**: ${parent.title}`,
          `- **Level**: ${parent.level}`,
          `- **Status**: ${parent.status}${parent.substatus ? ` (${parent.substatus})` : ''}`,
          `- **Project**: ${parent.project?.name ?? 'Unknown'}`,
          `- **Events**: ${parent.count} total, ${parent.userCount} users affected`,
          `- **First Seen**: ${parent.firstSeen}`,
          `- **Last Seen**: ${parent.lastSeen}`,
        ];

        if (parent.culprit) {
          lines.push(`- **Location**: ${parent.culprit}`);
        }
        if (parent.assignedTo) {
          lines.push(`- **Assigned To**: ${parent.assignedTo.name}`);
        }
        if (parent.metadata?.type) {
          lines.push(`- **Error Type**: ${parent.metadata.type}`);
        }
        if (parent.metadata?.value) {
          lines.push(`- **Error Message**: ${parent.metadata.value}`);
        }
        if (parent.metadata?.filename) {
          lines.push(`- **File**: ${parent.metadata.filename}`);
        }
        if (parent.metadata?.function) {
          lines.push(`- **Function**: ${parent.metadata.function}`);
        }
        if (parent.permalink) {
          lines.push(`- **URL**: ${parent.permalink}`);
        }

        return lines.join('\n');
      } catch (err: any) {
        ctx.logger?.error?.('Failed to resolve linkedContext for SentryIssue', {
          issueId: parent.id,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },
  },

  Query: {
    sentryConnectionStatus: async (_: unknown, _args: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client) {
        return { connected: false, organizationName: null, organizationSlug: null };
      }

      try {
        const org = await client.request(`/organizations/${client.organization}/`);
        return {
          connected: true,
          organizationName: org.name,
          organizationSlug: org.slug,
        };
      } catch {
        return { connected: false, organizationName: null, organizationSlug: null };
      }
    },

    sentryIssues: async (
      _: unknown,
      { query, project, sort, statsPeriod, limit }: { query?: string; project?: string; sort?: string; statsPeriod?: string; limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const params: Record<string, unknown> = {
          query: query ?? 'is:unresolved',
          limit: limit ?? 25,
        };
        if (project) params.project = project;
        if (sort) params.sort = sort;
        if (statsPeriod) params.statsPeriod = statsPeriod;

        const issues = await client.request(
          `/organizations/${client.organization}/issues/`,
          { params },
        );
        return issues.map(issueToGraphQL);
      } catch (err: any) {
        ctx.logger?.error?.('Failed to list Sentry issues', { error: err?.message ?? String(err) });
        return [];
      }
    },

    sentryIssue: async (
      _: unknown,
      { id }: { id: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return null;

      try {
        const issue = await client.request(`/issues/${id}/`);
        return issueToGraphQL(issue);
      } catch (err: any) {
        ctx.logger?.error?.('Failed to get Sentry issue', { id, error: err?.message ?? String(err) });
        return null;
      }
    },

    sentryIssueByShortId: async (
      _: unknown,
      { shortId }: { shortId: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return null;

      try {
        const issues = await client.request(
          `/organizations/${client.organization}/issues/`,
          { params: { query: shortId, shortIdLookup: '1', limit: 1 } },
        );
        const match = issues.find(
          (i: any) => i.shortId?.toLowerCase() === shortId.toLowerCase(),
        );
        return match ? issueToGraphQL(match) : null;
      } catch (err: any) {
        ctx.logger?.error?.('Failed to get Sentry issue by shortId', { shortId, error: err?.message ?? String(err) });
        return null;
      }
    },

    sentryIssueEvents: async (
      _: unknown,
      { issueId, limit }: { issueId: string; limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        return await client.request(`/issues/${issueId}/events/`, {
          params: { limit: limit ?? 10 },
        });
      } catch (err: any) {
        ctx.logger?.error?.('Failed to list issue events', { issueId, error: err?.message ?? String(err) });
        return [];
      }
    },

    sentryLatestEvent: async (
      _: unknown,
      { issueId }: { issueId: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return null;

      try {
        return await client.request(`/issues/${issueId}/events/latest/`);
      } catch (err: any) {
        ctx.logger?.error?.('Failed to get latest event', { issueId, error: err?.message ?? String(err) });
        return null;
      }
    },

    sentryProjects: async (_: unknown, _args: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const projects = await client.request(
          `/organizations/${client.organization}/projects/`,
        );
        return projects.map((p: any) => ({
          id: String(p.id),
          slug: p.slug,
          name: p.name,
          platform: p.platform,
        }));
      } catch (err: any) {
        ctx.logger?.error?.('Failed to list projects', { error: err?.message ?? String(err) });
        return [];
      }
    },

    sentryMembers: async (_: unknown, _args: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const members = await client.request(
          `/organizations/${client.organization}/members/`,
        );
        return members.map((m: any) => ({
          id: m.user?.id ?? m.id,
          name: m.user?.name ?? m.name,
          email: m.user?.email ?? m.email,
        }));
      } catch (err: any) {
        ctx.logger?.error?.('Failed to list members', { error: err?.message ?? String(err) });
        return [];
      }
    },
  },

  Mutation: {
    sentryResolveIssue: async (
      _: unknown,
      { id }: { id: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Sentry token configured' };

      try {
        const issue = await client.request(`/issues/${id}/`, {
          method: 'PUT',
          body: { status: 'resolved' },
        });
        return { success: true, message: `Resolved ${issue.shortId}: ${issue.title}` };
      } catch (err: any) {
        return { success: false, message: `Failed to resolve: ${err?.message ?? String(err)}` };
      }
    },

    sentryUnresolveIssue: async (
      _: unknown,
      { id }: { id: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Sentry token configured' };

      try {
        const issue = await client.request(`/issues/${id}/`, {
          method: 'PUT',
          body: { status: 'unresolved' },
        });
        return { success: true, message: `Reopened ${issue.shortId}: ${issue.title}` };
      } catch (err: any) {
        return { success: false, message: `Failed to unresolve: ${err?.message ?? String(err)}` };
      }
    },

    sentryIgnoreIssue: async (
      _: unknown,
      { id, ignoreDuration }: { id: string; ignoreDuration?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Sentry token configured' };

      try {
        const body: Record<string, unknown> = { status: 'ignored' };
        if (ignoreDuration) {
          body.statusDetails = { ignoreDuration };
        }
        const issue = await client.request(`/issues/${id}/`, {
          method: 'PUT',
          body,
        });
        return { success: true, message: `Ignored ${issue.shortId}: ${issue.title}` };
      } catch (err: any) {
        return { success: false, message: `Failed to ignore: ${err?.message ?? String(err)}` };
      }
    },

    sentryAssignIssue: async (
      _: unknown,
      { id, assignedTo }: { id: string; assignedTo: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Sentry token configured' };

      try {
        const issue = await client.request(`/issues/${id}/`, {
          method: 'PUT',
          body: { assignedTo },
        });
        return {
          success: true,
          message: `Assigned ${issue.shortId} to ${issue.assignedTo?.name ?? assignedTo}`,
        };
      } catch (err: any) {
        return { success: false, message: `Failed to assign: ${err?.message ?? String(err)}` };
      }
    },

    sentryUnassignIssue: async (
      _: unknown,
      { id }: { id: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Sentry token configured' };

      try {
        const issue = await client.request(`/issues/${id}/`, {
          method: 'PUT',
          body: { assignedTo: null },
        });
        return { success: true, message: `Unassigned ${issue.shortId}` };
      } catch (err: any) {
        return { success: false, message: `Failed to unassign: ${err?.message ?? String(err)}` };
      }
    },
  },
};
