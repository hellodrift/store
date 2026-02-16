/**
 * Linear Integration — Shared auth + client + discovery methods.
 *
 * Owns the LinearClient lifecycle and exposes discovery operations
 * (list_teams, list_members, etc.) that any Linear entity can call.
 */

import { z } from 'zod';
import { defineIntegration } from '@drift/entity-sdk';
import { LinearClient } from '@linear/sdk';

// ---------- Discovery input schemas ----------

const listMembersInput = z.object({
  teamId: z.string().optional().describe('Optional team ID to filter members by team'),
});

const listStatesInput = z.object({
  teamId: z.string().describe('Team ID (required — workflow states are per-team). Call list_teams first to get a teamId.'),
});

const listLabelsInput = z.object({
  teamId: z.string().optional().describe('Optional team ID to get team-specific labels. Omit for workspace-wide labels.'),
});

const listProjectsInput = z.object({
  teamId: z.string().optional().describe('Optional team ID to filter projects'),
});

const listCyclesInput = z.object({
  teamId: z.string().describe('Team ID (required — cycles are per-team). Call list_teams first to get a teamId.'),
});

const deleteIssueInput = z.object({
  issueId: z.string().describe('The UUID of the issue to delete'),
});

const archiveIssueInput = z.object({
  issueId: z.string().describe('The UUID of the issue to archive'),
});

const unarchiveIssueInput = z.object({
  issueId: z.string().describe('The UUID of the issue to unarchive'),
});

const createIssueRelationInput = z.object({
  issueId: z.string().describe('The UUID of the source issue'),
  relatedIssueId: z.string().describe('The UUID of the related issue'),
  type: z.enum(['blocks', 'duplicate', 'related']).describe('Relation type: "blocks" (issueId blocks relatedIssueId), "duplicate" (issueId duplicates relatedIssueId), "related" (general relation)'),
});

const deleteIssueRelationInput = z.object({
  relationId: z.string().describe('The UUID of the issue relation to delete. Use list_issue_relations to find relation IDs.'),
});

const listIssueRelationsInput = z.object({
  issueId: z.string().describe('The UUID of the issue to list relations for'),
});

const listCommentsInput = z.object({
  issueId: z.string().describe('The UUID of the issue to list comments for'),
});

const searchIssuesInput = z.object({
  query: z.string().describe('Full-text search query'),
  limit: z.number().int().min(1).max(50).optional().describe('Max results to return (default 10, max 50)'),
});

const editIssueInput = z.object({
  issueId: z.string().describe('The UUID of the issue to edit'),
  title: z.string().optional().describe('New title'),
  description: z.string().optional().describe('New description (markdown)'),
  priority: z.number().int().min(0).max(4).optional().describe('New priority: 0=none, 1=urgent, 2=high, 3=normal, 4=low'),
  assigneeId: z.string().nullable().optional().describe('User UUID to assign, or null to unassign. Call list_members to find valid IDs.'),
  stateId: z.string().optional().describe('Workflow state UUID. Call list_states to find valid IDs.'),
  labelIds: z.array(z.string()).optional().describe('Replace ALL labels with these IDs. Call list_labels to find valid IDs.'),
  projectId: z.string().nullable().optional().describe('Project UUID, or null to remove from project'),
  cycleId: z.string().nullable().optional().describe('Cycle UUID, or null to remove from cycle'),
  estimate: z.number().nullable().optional().describe('Estimate points, or null to clear'),
  dueDate: z.string().nullable().optional().describe('Due date YYYY-MM-DD, or null to clear'),
  teamId: z.string().optional().describe('Move issue to a different team (team UUID)'),
});

// ---------- Integration definition ----------

export const linearIntegration = defineIntegration<LinearClient>({
  id: 'linear',
  displayName: 'Linear',
  description: 'Linear project management API',
  icon: 'linear',

  secureKeys: ['api_token'],

  oauth: {
    providers: [
      {
        providerId: 'linear',
        displayName: 'Linear',
        icon: 'linear',
        required: false,
        flow: {
          grantType: 'authorization_code',
          clientId: process.env.LINEAR_OAUTH_CLIENT_ID ?? '',
          authorizationUrl: 'https://linear.app/oauth/authorize',
          tokenUrl: 'https://api.linear.app/oauth/token',
          scopes: ['read', 'write', 'issues:create', 'comments:create'],
          scopeSeparator: ',',
          redirectPort: 5763,
          redirectPath: '/callbacks/linear',
          pkce: { enabled: true, method: 'S256' },
        },
        revocationUrl: 'https://api.linear.app/oauth/revoke',
      },
    ],
  },

  createClient: async (ctx) => {
    // Prefer OAuth token (authorization code flow)
    if (ctx.oauth) {
      const oauthToken = await ctx.oauth.getAccessToken('linear');
      if (oauthToken) {
        return new LinearClient({ accessToken: oauthToken });
      }
    }

    // Fall back to personal API key
    const apiKey = await ctx.storage.get('api_token');
    if (apiKey) {
      return new LinearClient({ apiKey });
    }

    ctx.logger.warn('No OAuth token or API key configured for Linear');
    return null;
  },

  methods: [
    {
      id: 'list_teams',
      description: 'Discover available Linear teams and their IDs',
      aiHint: 'Use to discover available teams and their UUIDs. Call this BEFORE create_issue to find the correct teamId. Returns team id, name, key, and description.',
      handler: async (client) => {
        const result = await client.teams();
        return {
          teams: result.nodes.map((t: any) => ({
            id: t.id,
            name: t.name,
            key: t.key,
            description: t.description ?? undefined,
          })),
        };
      },
    },
    {
      id: 'list_members',
      description: 'Discover team members or all workspace users',
      aiHint: 'Use to find team members for assignment. Provides user UUIDs needed for assigneeId in create_issue, update_issue, and assign. Optionally filter by teamId.',
      inputSchema: listMembersInput,
      handler: async (client, input) => {
        const { teamId } = input as z.infer<typeof listMembersInput>;

        let members: any[];
        if (teamId) {
          const team = await client.team(teamId);
          const result = await team.members();
          members = result.nodes;
        } else {
          const result = await client.users();
          members = result.nodes;
        }

        return {
          members: members.map((m: any) => ({
            id: m.id,
            name: m.name,
            displayName: m.displayName ?? m.name,
            email: m.email ?? undefined,
            active: m.active ?? true,
          })),
        };
      },
    },
    {
      id: 'list_states',
      description: 'Discover workflow states for a team',
      aiHint: 'Use to find workflow states for a team. Provides stateId UUIDs needed for create_issue, update_issue, and transition. Call list_teams first to get a teamId. States are sorted by type: triage → backlog → unstarted → started → completed → cancelled.',
      inputSchema: listStatesInput,
      handler: async (client, input) => {
        const { teamId } = input as z.infer<typeof listStatesInput>;

        const team = await client.team(teamId);
        const result = await team.states();

        const typeOrder: Record<string, number> = {
          triage: 0, backlog: 1, unstarted: 2, started: 3, completed: 4, cancelled: 5,
        };

        const states = result.nodes
          .map((s: any) => ({
            id: s.id,
            name: s.name,
            color: s.color ?? '',
            type: s.type ?? 'unstarted',
            position: s.position ?? 0,
          }))
          .sort((a: any, b: any) => {
            const typeA = typeOrder[a.type] ?? 99;
            const typeB = typeOrder[b.type] ?? 99;
            if (typeA !== typeB) return typeA - typeB;
            return a.position - b.position;
          });

        return { states };
      },
    },
    {
      id: 'list_labels',
      description: 'Discover available labels',
      aiHint: 'Use to find available labels and their UUIDs. Provides labelId needed for create_issue labelIds, add_label, and remove_label. Optionally pass teamId for team-specific labels, or omit for workspace labels.',
      inputSchema: listLabelsInput,
      handler: async (client, input) => {
        const { teamId } = input as z.infer<typeof listLabelsInput>;

        let labelNodes: any[];
        if (teamId) {
          const team = await client.team(teamId);
          const result = await team.labels();
          labelNodes = result.nodes;
        } else {
          const result = await client.issueLabels();
          labelNodes = result.nodes;
        }

        return {
          labels: labelNodes.map((l: any) => ({
            id: l.id,
            name: l.name,
            color: l.color ?? '',
            description: l.description ?? undefined,
          })),
        };
      },
    },
    {
      id: 'list_projects',
      description: 'Discover available projects',
      aiHint: 'Use to find projects and their UUIDs. Provides projectId for create_issue and update_issue. Optionally filter by teamId.',
      inputSchema: listProjectsInput,
      handler: async (client, input) => {
        const { teamId } = input as z.infer<typeof listProjectsInput>;

        let projectNodes: any[];
        if (teamId) {
          const team = await client.team(teamId);
          const result = await team.projects();
          projectNodes = result.nodes;
        } else {
          const result = await client.projects();
          projectNodes = result.nodes;
        }

        const projects = await Promise.all(projectNodes.map(async (p: any) => {
          let leadName: string | undefined;
          try {
            const lead = await p.lead;
            leadName = lead?.name;
          } catch {
            // lead resolution failed
          }
          return {
            id: p.id,
            name: p.name,
            description: p.description ?? undefined,
            status: p.state ?? undefined,
            leadName,
          };
        }));

        return { projects };
      },
    },
    {
      id: 'list_cycles',
      description: 'Discover sprint cycles for a team',
      aiHint: 'Use to find sprint cycles and their UUIDs. Provides cycleId for create_issue. teamId is required — cycles are per-team. Call list_teams first to get a teamId.',
      inputSchema: listCyclesInput,
      handler: async (client, input) => {
        const { teamId } = input as z.infer<typeof listCyclesInput>;

        const team = await client.team(teamId);
        const result = await team.cycles();

        const now = new Date();
        const cycles = result.nodes.map((c: any) => ({
          id: c.id,
          name: c.name ?? `Cycle ${c.number}`,
          number: c.number,
          startsAt: c.startsAt ?? undefined,
          endsAt: c.endsAt ?? undefined,
          isActive: c.startsAt && c.endsAt
            ? new Date(c.startsAt) <= now && now <= new Date(c.endsAt)
            : false,
        }));

        return { cycles };
      },
    },
    {
      id: 'edit_issue',
      description: 'Edit an existing Linear issue',
      aiHint: 'Use when the user wants to update/edit fields on an existing Linear issue (title, description, priority, assignee, state, labels, project, cycle, estimate, due date, or move to another team). Requires the issueId UUID. Call list_teams, list_members, list_states, list_labels, list_projects, or list_cycles first to discover valid UUIDs for the fields you want to change.',
      inputSchema: editIssueInput,
      mutation: true,
      handler: async (client, input) => {
        const { issueId, ...fields } = input as z.infer<typeof editIssueInput>;

        const updateData: Record<string, unknown> = {};
        if (fields.title !== undefined) updateData.title = fields.title;
        if (fields.description !== undefined) updateData.description = fields.description;
        if (fields.priority !== undefined) updateData.priority = fields.priority;
        if (fields.assigneeId !== undefined) updateData.assigneeId = fields.assigneeId;
        if (fields.stateId !== undefined) updateData.stateId = fields.stateId;
        if (fields.labelIds !== undefined) updateData.labelIds = fields.labelIds;
        if (fields.projectId !== undefined) updateData.projectId = fields.projectId;
        if (fields.cycleId !== undefined) updateData.cycleId = fields.cycleId;
        if (fields.estimate !== undefined) updateData.estimate = fields.estimate;
        if (fields.dueDate !== undefined) updateData.dueDate = fields.dueDate;
        if (fields.teamId !== undefined) updateData.teamId = fields.teamId;

        const payload = await client.updateIssue(issueId, updateData);
        const issue = await payload.issue;

        if (!issue) {
          return { success: false, message: 'Issue update returned no result' };
        }

        return {
          success: true,
          message: `Updated issue ${issue.identifier}: ${issue.title}`,
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            url: issue.url,
          },
        };
      },
    },
    {
      id: 'delete_issue',
      description: 'Delete a Linear issue permanently',
      aiHint: 'Use when the user wants to permanently delete a Linear issue. This action is irreversible. Requires the issueId UUID.',
      inputSchema: deleteIssueInput,
      mutation: true,
      handler: async (client, input) => {
        const { issueId } = input as z.infer<typeof deleteIssueInput>;
        const payload = await client.deleteIssue(issueId);

        return {
          success: payload.success,
          message: payload.success
            ? `Deleted issue ${issueId}`
            : `Failed to delete issue ${issueId}`,
        };
      },
    },
    {
      id: 'archive_issue',
      description: 'Archive a Linear issue (reversible soft-delete)',
      aiHint: 'Use when the user wants to archive an issue. This is reversible — use unarchive_issue to restore. Prefer this over delete_issue for most workflows.',
      inputSchema: archiveIssueInput,
      mutation: true,
      handler: async (client, input) => {
        const { issueId } = input as z.infer<typeof archiveIssueInput>;
        const payload = await client.archiveIssue(issueId);

        return {
          success: payload.success,
          message: payload.success
            ? `Archived issue ${issueId}`
            : `Failed to archive issue ${issueId}`,
        };
      },
    },
    {
      id: 'unarchive_issue',
      description: 'Unarchive a previously archived Linear issue',
      aiHint: 'Use to restore an archived issue back to its previous state.',
      inputSchema: unarchiveIssueInput,
      mutation: true,
      handler: async (client, input) => {
        const { issueId } = input as z.infer<typeof unarchiveIssueInput>;
        const payload = await client.unarchiveIssue(issueId);

        return {
          success: payload.success,
          message: payload.success
            ? `Unarchived issue ${issueId}`
            : `Failed to unarchive issue ${issueId}`,
        };
      },
    },
    {
      id: 'create_issue_relation',
      description: 'Create a relation between two issues',
      aiHint: 'Use to link two issues together. Relation types: "blocks" (issueId blocks relatedIssueId from proceeding), "duplicate" (issueId is a duplicate of relatedIssueId), "related" (general relation). Requires UUIDs for both issues.',
      inputSchema: createIssueRelationInput,
      mutation: true,
      handler: async (client, input) => {
        const { issueId, relatedIssueId, type } = input as z.infer<typeof createIssueRelationInput>;
        const payload = await client.createIssueRelation({ issueId, relatedIssueId, type });
        const relation = await payload.issueRelation;

        if (!relation) {
          return { success: false, message: 'Issue relation creation returned no result' };
        }

        return {
          success: true,
          message: `Created "${type}" relation from ${issueId} to ${relatedIssueId}`,
          relation: { id: relation.id, type: relation.type },
        };
      },
    },
    {
      id: 'delete_issue_relation',
      description: 'Delete a relation between two issues',
      aiHint: 'Use to remove a relation between issues. Call list_issue_relations first to find the relationId UUID.',
      inputSchema: deleteIssueRelationInput,
      mutation: true,
      handler: async (client, input) => {
        const { relationId } = input as z.infer<typeof deleteIssueRelationInput>;
        const payload = await client.deleteIssueRelation(relationId);

        return {
          success: payload.success,
          message: payload.success
            ? `Deleted issue relation ${relationId}`
            : `Failed to delete issue relation ${relationId}`,
        };
      },
    },
    {
      id: 'list_issue_relations',
      description: 'List all relations for an issue',
      aiHint: 'Use to discover what issues are related to a given issue (blocks, blocked by, duplicates, related). Returns relation IDs needed for delete_issue_relation.',
      inputSchema: listIssueRelationsInput,
      handler: async (client, input) => {
        const { issueId } = input as z.infer<typeof listIssueRelationsInput>;
        const issue = await client.issue(issueId);
        const relations = await issue.relations();

        return {
          relations: await Promise.all(relations.nodes.map(async (r: any) => {
            const relatedIssue = await r.relatedIssue;
            return {
              id: r.id,
              type: r.type,
              relatedIssueId: relatedIssue?.id,
              relatedIssueIdentifier: relatedIssue?.identifier,
              relatedIssueTitle: relatedIssue?.title,
            };
          })),
        };
      },
    },
    {
      id: 'list_comments',
      description: 'List comments on an issue',
      aiHint: 'Use to read comments on an issue. Returns comment body (markdown), author name, and timestamps.',
      inputSchema: listCommentsInput,
      handler: async (client, input) => {
        const { issueId } = input as z.infer<typeof listCommentsInput>;
        const issue = await client.issue(issueId);
        const comments = await issue.comments();

        return {
          comments: await Promise.all(comments.nodes.map(async (c: any) => {
            let authorName: string | undefined;
            try {
              const user = await c.user;
              authorName = user?.name ?? user?.displayName;
            } catch {
              // author resolution failed
            }
            return {
              id: c.id,
              body: c.body,
              authorName,
              createdAt: c.createdAt,
              updatedAt: c.updatedAt,
            };
          })),
        };
      },
    },
    {
      id: 'search_issues',
      description: 'Full-text search for Linear issues',
      aiHint: 'Use for powerful full-text search across issue titles, descriptions, and comments. More comprehensive than filtering by title. Returns matching issues with their details.',
      inputSchema: searchIssuesInput,
      handler: async (client, input) => {
        const { query, limit } = input as z.infer<typeof searchIssuesInput>;
        const result = await client.searchIssues(query, { first: limit ?? 10 });

        return {
          issues: result.nodes.map((issue: any) => ({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            url: issue.url,
            priority: issue.priority ?? 0,
            createdAt: issue.createdAt,
          })),
        };
      },
    },
  ],
});

export default linearIntegration;
