/**
 * linear_issue entity — Real Linear API integration with actions.
 *
 * Uses the `linear` integration for auth and discovery.
 * Actions: create_issue, update_issue, transition,
 * assign, add_label, remove_label, add_comment,
 * delete_issue, archive_issue, unarchive_issue.
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';
import type { LinearClient } from '@linear/sdk';

// ---------- Priority label map ----------

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

// ---------- Schema ----------

const linearIssueSchema = z.object({
  id: z.string(),
  type: z.literal('linear_issue'),
  uri: z.string(),
  title: z.string(),
  identifier: z.string().optional(),
  status: z.string().optional(),
  stateId: z.string().optional(),
  stateName: z.string().optional(),
  priority: z.number().int().min(0).max(4),
  priorityLabel: z.string().optional(),
  assigneeId: z.string().optional(),
  assigneeName: z.string().optional(),
  teamId: z.string().optional(),
  teamName: z.string().optional(),
  teamKey: z.string().optional(),
  labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })).optional(),
  labelNames: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  cycleId: z.string().optional(),
  cycleName: z.string().optional(),
  estimate: z.number().optional(),
  dueDate: z.string().optional(),
  parentId: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

type LinearIssue = z.infer<typeof linearIssueSchema>;

// ---------- Helpers ----------

function getClient(ctx: EntityResolverContext): LinearClient | null {
  return (ctx as any).integrations?.linear?.client ?? null;
}

async function issueToEntity(issue: any): Promise<LinearIssue> {
  const state = issue._state
    ? await (issue as any).state
    : undefined;

  // Resolve assignee name
  let assigneeName: string | undefined;
  if (issue._assignee) {
    try {
      const assignee = await (issue as any).assignee;
      assigneeName = assignee?.name ?? assignee?.displayName;
    } catch {
      // assignee resolution failed, leave undefined
    }
  }

  // Resolve team name/key
  let teamName: string | undefined;
  let teamKey: string | undefined;
  if (issue._team) {
    try {
      const team = await (issue as any).team;
      teamName = team?.name;
      teamKey = team?.key;
    } catch {
      // team resolution failed, leave undefined
    }
  }

  // Resolve labels
  let labels: { id: string; name: string; color: string }[] | undefined;
  let labelNames: string | undefined;
  try {
    const labelsConn = await (issue as any).labels();
    if (labelsConn?.nodes?.length) {
      labels = labelsConn.nodes.map((l: any) => ({ id: l.id, name: l.name, color: l.color ?? '' }));
      labelNames = labels!.map((l) => l.name).join(', ');
    }
  } catch {
    // labels resolution failed, leave undefined
  }

  // Resolve project
  let projectId: string | undefined;
  let projectName: string | undefined;
  try {
    const project = await (issue as any).project;
    if (project) {
      projectId = project.id;
      projectName = project.name;
    }
  } catch {
    // project resolution failed
  }

  // Resolve cycle
  let cycleId: string | undefined;
  let cycleName: string | undefined;
  try {
    const cycle = await (issue as any).cycle;
    if (cycle) {
      cycleId = cycle.id;
      cycleName = cycle.name ?? cycle.number?.toString();
    }
  } catch {
    // cycle resolution failed
  }

  // Resolve parent
  let parentId: string | undefined;
  try {
    const parent = await (issue as any).parent;
    if (parent) {
      parentId = parent.id;
    }
  } catch {
    // parent resolution failed
  }

  const priority = issue.priority ?? 0;

  return {
    id: issue.id,
    type: 'linear_issue',
    uri: `@drift//linear_issue/${issue.id}`,
    title: issue.title,
    identifier: issue.identifier,
    status: state?.name?.toLowerCase().replace(/\s+/g, '_'),
    stateId: state?.id,
    stateName: state?.name,
    priority,
    priorityLabel: PRIORITY_LABELS[priority] ?? 'Unknown',
    assigneeId: issue._assignee?.id,
    assigneeName,
    teamId: issue._team?.id,
    teamName,
    teamKey,
    labels,
    labelNames,
    projectId,
    projectName,
    cycleId,
    cycleName,
    estimate: issue.estimate ?? undefined,
    dueDate: issue.dueDate ?? undefined,
    parentId,
    description: issue.description,
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

// ---------- Action input schemas ----------

const createIssueInput = z.object({
  title: z.string().describe('Issue title'),
  teamId: z.string().describe('Team UUID. Call list_teams first to get a valid teamId.'),
  description: z.string().optional().describe('Issue description in markdown'),
  priority: z.number().int().min(0).max(4).optional().describe('Priority: 0=none, 1=urgent, 2=high, 3=normal, 4=low'),
  assigneeId: z.string().optional().describe('User UUID to assign. Call list_members to find valid IDs.'),
  stateId: z.string().optional().describe('Workflow state UUID. Call list_states to find valid IDs.'),
  labelIds: z.array(z.string()).optional().describe('Label UUIDs to attach. Call list_labels to find valid IDs.'),
  projectId: z.string().optional().describe('Project UUID. Call list_projects to find valid IDs.'),
  cycleId: z.string().optional().describe('Cycle/sprint UUID. Call list_cycles to find valid IDs.'),
  parentId: z.string().optional().describe('Parent issue UUID for sub-issues'),
  estimate: z.number().optional().describe('Complexity estimate points'),
  dueDate: z.string().optional().describe('Due date in YYYY-MM-DD format'),
});

const updateIssueInput = z.object({
  title: z.string().optional().describe('New title'),
  description: z.string().optional().describe('New description'),
  priority: z.number().int().min(0).max(4).optional().describe('New priority'),
  assigneeId: z.string().optional().describe('New assignee user UUID'),
  stateId: z.string().optional().describe('New workflow state UUID'),
  labelIds: z.array(z.string()).optional().describe('Replace ALL labels with these IDs. Use add_label/remove_label for incremental changes.'),
  projectId: z.string().nullable().optional().describe('New project UUID, or null to remove from project'),
  cycleId: z.string().nullable().optional().describe('New cycle UUID, or null to remove from cycle'),
  estimate: z.number().nullable().optional().describe('New estimate points, or null to clear'),
  dueDate: z.string().nullable().optional().describe('New due date YYYY-MM-DD, or null to clear'),
  teamId: z.string().optional().describe('Move issue to a different team (team UUID)'),
});

const transitionInput = z.object({
  stateId: z.string().describe('Target workflow state UUID. Call list_states to find valid IDs.'),
});

const assignInput = z.object({
  assigneeId: z.string().nullable().describe('User UUID to assign, or null to unassign. Call list_members to find valid IDs.'),
});

const addLabelInput = z.object({
  labelId: z.string().describe('Label UUID to add. Call list_labels to find valid IDs.'),
});

const removeLabelInput = z.object({
  labelId: z.string().describe('Label UUID to remove'),
});

const addCommentInput = z.object({
  body: z.string().describe('Comment body in markdown'),
});

// ---------- Entity definition ----------

const LinearIssueEntity = defineEntity({
  type: 'linear_issue',
  displayName: 'Linear Issue',
  description: 'An issue from Linear project management',
  icon: 'linear',

  schema: linearIssueSchema,

  uriPath: {
    segments: ['id'] as const,
    parse: (segments: string[]) => ({ id: segments[0] }),
    format: ({ id }: { id: string }) => id,
  },

  display: {
    emoji: '\u{1F4CB}',
    colors: {
      bg: '#5E6AD2',
      text: '#FFFFFF',
      border: '#4E5BBF',
    },
    description: 'Linear project management issues',
    filterDescriptions: [
      { name: 'status', type: 'string', description: 'Filter by issue status' },
      { name: 'priority', type: 'number', description: 'Filter by priority level (0=none, 1=urgent, 2=high, 3=normal, 4=low)' },
      { name: 'assigneeId', type: 'string', description: 'Filter by assignee user ID' },
    ],
    outputFields: [
      { key: 'identifier', label: 'Identifier', metadataPath: 'identifier', format: 'string' },
      { key: 'status', label: 'Status', metadataPath: 'stateName', format: 'string' },
      { key: 'priority', label: 'Priority', metadataPath: 'priorityLabel', format: 'string' },
      { key: 'assignee', label: 'Assignee', metadataPath: 'assigneeName', format: 'string' },
      { key: 'project', label: 'Project', metadataPath: 'projectName', format: 'string' },
      { key: 'labels', label: 'Labels', metadataPath: 'labelNames', format: 'string' },
      { key: 'dueDate', label: 'Due Date', metadataPath: 'dueDate', format: 'string' },
      { key: 'url', label: 'URL', metadataPath: 'url', format: 'string' },
    ],
  },

  paletteFilters: [
    {
      // Matches metadata.status (stored as lowercase with underscores, e.g. "in_progress").
      // Filter IDs use hyphens; applyFilters normalizes both before comparing.
      // Values are fetched dynamically so each org sees their own workflow states.
      key: 'status',
      label: 'Status',
      aliases: ['s'],
      values: [], // placeholder — overridden by fetchValues at runtime
      fetchValues: async (ctx: EntityResolverContext) => {
        const client = getClient(ctx);
        if (!client) return [];
        try {
          const states = await client.workflowStates();
          if (!states?.nodes) return [];
          // Deduplicate by normalized name — workflowStates() returns states
          // from ALL teams, so multi-team orgs see duplicates.
          const seen = new Set<string>();
          return states.nodes
            .map((state: any) => ({
              // ID matches the normalization in issueToEntity and applyFilters:
              // state.name "In Progress" → metadata.status "in_progress" → normalized "in-progress"
              id: state.name.toLowerCase().replace(/\s+/g, '-'),
              label: state.name,
              colorToken:
                state.type === 'completed' ? 'success'
                : state.type === 'cancelled' ? 'muted'
                : state.type === 'started' ? 'brand'
                : undefined,
            }))
            .filter((v: { id: string }) => {
              if (seen.has(v.id)) return false;
              seen.add(v.id);
              return true;
            });
        } catch {
          return [];
        }
      },
    },
    {
      // Matches metadata.priorityLabel ("Urgent", "High", "Normal", "Low", "No priority")
      // Aliased as 'priority' and 'p' so users can type "priority:high"
      key: 'priorityLabel',
      label: 'Priority',
      aliases: ['priority', 'p'],
      values: [
        { id: 'urgent',      label: 'Urgent',      colorToken: 'error'   },
        { id: 'high',        label: 'High',         colorToken: 'warning' },
        { id: 'normal',      label: 'Normal',       colorToken: 'brand'   },
        { id: 'low',         label: 'Low',          colorToken: 'muted'   },
        { id: 'no-priority', label: 'No Priority'                         },
      ],
    },
  ],

  integrations: { linear: 'linear' },

  cache: {
    ttl: 30_000,
    maxSize: 100,
  },

  actions: [
    {
      id: 'create_issue',
      label: 'Create Issue',
      description: 'Create a new Linear issue',
      icon: 'plus',
      scope: 'type',
      aiHint: 'Use when the user wants to create a new issue. IMPORTANT: First call list_teams to get a valid teamId (UUID). Optionally call list_members, list_labels, list_states, list_projects, list_cycles to get UUIDs for assigneeId, labelIds, stateId, projectId, cycleId.',
      inputSchema: createIssueInput,
      handler: async (params: EntityActionParams<LinearIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API token configured' };

        const input = params.input as z.infer<typeof createIssueInput>;
        ctx.logger.info('Creating Linear issue', { title: input.title, teamId: input.teamId });

        const payload = await client.createIssue({
          title: input.title,
          teamId: input.teamId,
          description: input.description,
          priority: input.priority,
          assigneeId: input.assigneeId,
          stateId: input.stateId,
          labelIds: input.labelIds,
          projectId: input.projectId,
          cycleId: input.cycleId,
          parentId: input.parentId,
          estimate: input.estimate,
          dueDate: input.dueDate,
        });

        const issue = await payload.issue;
        if (!issue) return { success: false, message: 'Issue creation returned no result' };

        const entity = await issueToEntity(issue);
        return {
          success: true,
          message: `Created issue ${issue.identifier}: ${issue.title}`,
          entity,
        };
      },
    },
    {
      id: 'update_issue',
      label: 'Update Issue',
      description: 'Update fields on an existing Linear issue',
      icon: 'edit',
      scope: 'instance',
      aiHint: 'Use when the user wants to modify an existing issue (title, description, priority, assignee, labels, project, cycle, estimate, due date, or move to another team)',
      inputSchema: updateIssueInput,
      handler: async (params: EntityActionParams<LinearIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API token configured' };

        if (!params.entity) return { success: false, message: 'No entity provided for instance action' };

        const input = params.input as z.infer<typeof updateIssueInput>;
        ctx.logger.info('Updating Linear issue', { issueId: params.entity.id });

        const updateData: Record<string, unknown> = {};
        if (input.title !== undefined) updateData.title = input.title;
        if (input.description !== undefined) updateData.description = input.description;
        if (input.priority !== undefined) updateData.priority = input.priority;
        if (input.assigneeId !== undefined) updateData.assigneeId = input.assigneeId;
        if (input.stateId !== undefined) updateData.stateId = input.stateId;
        if (input.labelIds !== undefined) updateData.labelIds = input.labelIds;
        if (input.projectId !== undefined) updateData.projectId = input.projectId;
        if (input.cycleId !== undefined) updateData.cycleId = input.cycleId;
        if (input.estimate !== undefined) updateData.estimate = input.estimate;
        if (input.dueDate !== undefined) updateData.dueDate = input.dueDate;
        if (input.teamId !== undefined) updateData.teamId = input.teamId;

        const payload = await client.updateIssue(params.entity.id, updateData);
        const issue = await payload.issue;
        if (!issue) return { success: false, message: 'Issue update returned no result' };

        const entity = await issueToEntity(issue);
        return {
          success: true,
          message: `Updated issue ${issue.identifier}`,
          entity,
        };
      },
    },
    {
      id: 'transition',
      label: 'Transition',
      description: 'Change issue workflow state',
      icon: 'arrow-right',
      scope: 'instance',
      aiHint: 'Use when the user wants to change the status/state of an issue. Call list_states first to find valid stateId UUIDs for the issue\'s team.',
      inputSchema: transitionInput,
      handler: async (params: EntityActionParams<LinearIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API token configured' };

        if (!params.entity) return { success: false, message: 'No entity provided for instance action' };

        const input = params.input as z.infer<typeof transitionInput>;
        ctx.logger.info('Transitioning Linear issue', { issueId: params.entity.id, stateId: input.stateId });

        const payload = await client.updateIssue(params.entity.id, { stateId: input.stateId });
        const issue = await payload.issue;
        if (!issue) return { success: false, message: 'Issue transition returned no result' };

        const entity = await issueToEntity(issue);
        return {
          success: true,
          message: `Transitioned issue ${issue.identifier} to new state`,
          entity,
        };
      },
    },
    {
      id: 'assign',
      label: 'Assign',
      description: 'Assign or unassign a user on an issue',
      icon: 'user-plus',
      scope: 'instance',
      aiHint: 'Use to assign or unassign a user. Call list_members to find the assigneeId UUID. Pass null to unassign.',
      inputSchema: assignInput,
      handler: async (params: EntityActionParams<LinearIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API token configured' };

        if (!params.entity) return { success: false, message: 'No entity provided for instance action' };

        const input = params.input as z.infer<typeof assignInput>;
        ctx.logger.info('Assigning Linear issue', { issueId: params.entity.id, assigneeId: input.assigneeId });

        const payload = await client.updateIssue(params.entity.id, {
          assigneeId: input.assigneeId,
        });
        const issue = await payload.issue;
        if (!issue) return { success: false, message: 'Issue assign returned no result' };

        const entity = await issueToEntity(issue);
        return {
          success: true,
          message: input.assigneeId
            ? `Assigned issue ${issue.identifier}`
            : `Unassigned issue ${issue.identifier}`,
          entity,
        };
      },
    },
    {
      id: 'add_label',
      label: 'Add Label',
      description: 'Add a label to an issue without removing existing labels',
      icon: 'tag',
      scope: 'instance',
      aiHint: 'Use to add a label to an issue without removing existing labels. Call list_labels first to find the labelId UUID.',
      inputSchema: addLabelInput,
      handler: async (params: EntityActionParams<LinearIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API token configured' };

        if (!params.entity) return { success: false, message: 'No entity provided for instance action' };

        const input = params.input as z.infer<typeof addLabelInput>;
        ctx.logger.info('Adding label to Linear issue', { issueId: params.entity.id, labelId: input.labelId });

        // Fetch current labels
        const issue = await client.issue(params.entity.id);
        const currentLabels = await issue.labels();
        const currentIds = currentLabels.nodes.map((l: any) => l.id);

        if (currentIds.includes(input.labelId)) {
          return { success: true, message: 'Label already present on issue' };
        }

        const payload = await client.updateIssue(params.entity.id, {
          labelIds: [...currentIds, input.labelId],
        });
        const updated = await payload.issue;
        if (!updated) return { success: false, message: 'Add label returned no result' };

        const entity = await issueToEntity(updated);
        return {
          success: true,
          message: `Added label to issue ${updated.identifier}`,
          entity,
        };
      },
    },
    {
      id: 'remove_label',
      label: 'Remove Label',
      description: 'Remove a label from an issue without affecting other labels',
      icon: 'x',
      scope: 'instance',
      aiHint: 'Use to remove a label from an issue without affecting other labels.',
      inputSchema: removeLabelInput,
      handler: async (params: EntityActionParams<LinearIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API token configured' };

        if (!params.entity) return { success: false, message: 'No entity provided for instance action' };

        const input = params.input as z.infer<typeof removeLabelInput>;
        ctx.logger.info('Removing label from Linear issue', { issueId: params.entity.id, labelId: input.labelId });

        // Fetch current labels
        const issue = await client.issue(params.entity.id);
        const currentLabels = await issue.labels();
        const currentIds = currentLabels.nodes.map((l: any) => l.id);
        const newIds = currentIds.filter((id: string) => id !== input.labelId);

        if (newIds.length === currentIds.length) {
          return { success: true, message: 'Label was not present on issue' };
        }

        const payload = await client.updateIssue(params.entity.id, {
          labelIds: newIds,
        });
        const updated = await payload.issue;
        if (!updated) return { success: false, message: 'Remove label returned no result' };

        const entity = await issueToEntity(updated);
        return {
          success: true,
          message: `Removed label from issue ${updated.identifier}`,
          entity,
        };
      },
    },
    {
      id: 'add_comment',
      label: 'Add Comment',
      description: 'Add a comment to an issue',
      icon: 'message-circle',
      scope: 'instance',
      aiHint: 'Use when the user wants to comment on an issue',
      inputSchema: addCommentInput,
      handler: async (params: EntityActionParams<LinearIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API token configured' };

        if (!params.entity) return { success: false, message: 'No entity provided for instance action' };

        const input = params.input as z.infer<typeof addCommentInput>;
        ctx.logger.info('Adding comment to Linear issue', { issueId: params.entity.id });

        const payload = await client.createComment({
          issueId: params.entity.id,
          body: input.body,
        });

        const comment = await payload.comment;
        return {
          success: true,
          message: `Added comment to issue${params.entity.identifier ? ' ' + params.entity.identifier : ''}`,
          data: comment ? { commentId: comment.id } : undefined,
        };
      },
    },
    {
      id: 'delete_issue',
      label: 'Delete Issue',
      description: 'Permanently delete a Linear issue',
      icon: 'trash',
      scope: 'instance',
      aiHint: 'Use when the user wants to permanently delete a Linear issue. This action is irreversible.',
      handler: async (params: EntityActionParams<LinearIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API token configured' };

        if (!params.entity) return { success: false, message: 'No entity provided for instance action' };

        ctx.logger.info('Deleting Linear issue', { issueId: params.entity.id });

        const payload = await client.deleteIssue(params.entity.id);

        return {
          success: payload.success,
          message: payload.success
            ? `Deleted issue ${params.entity.identifier ?? params.entity.id}`
            : `Failed to delete issue ${params.entity.identifier ?? params.entity.id}`,
        };
      },
    },
    {
      id: 'archive_issue',
      label: 'Archive Issue',
      description: 'Archive a Linear issue (reversible)',
      icon: 'archive',
      scope: 'instance',
      aiHint: 'Use when the user wants to archive an issue. This is reversible — use unarchive_issue to restore. Prefer this over delete_issue.',
      handler: async (params: EntityActionParams<LinearIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API token configured' };

        if (!params.entity) return { success: false, message: 'No entity provided for instance action' };

        ctx.logger.info('Archiving Linear issue', { issueId: params.entity.id });

        const payload = await client.archiveIssue(params.entity.id);

        return {
          success: payload.success,
          message: payload.success
            ? `Archived issue ${params.entity.identifier ?? params.entity.id}`
            : `Failed to archive issue ${params.entity.identifier ?? params.entity.id}`,
        };
      },
    },
    {
      id: 'unarchive_issue',
      label: 'Unarchive Issue',
      description: 'Restore a previously archived Linear issue',
      icon: 'archive-restore',
      scope: 'instance',
      aiHint: 'Use when the user wants to restore an archived issue back to its previous state.',
      handler: async (params: EntityActionParams<LinearIssue>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API token configured' };

        if (!params.entity) return { success: false, message: 'No entity provided for instance action' };

        ctx.logger.info('Unarchiving Linear issue', { issueId: params.entity.id });

        const payload = await client.unarchiveIssue(params.entity.id);

        return {
          success: payload.success,
          message: payload.success
            ? `Unarchived issue ${params.entity.identifier ?? params.entity.id}`
            : `Failed to unarchive issue ${params.entity.identifier ?? params.entity.id}`,
        };
      },
    },
  ],

  resolve: async ({ id }: { id: string }, ctx) => {
    const client = getClient(ctx);
    if (!client) return null;

    ctx.logger.info('Resolving linear issue', { issueId: id });

    try {
      const issue = await client.issue(id);
      return await issueToEntity(issue);
    } catch (err) {
      ctx.logger.error('Failed to resolve linear issue', {
        issueId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  search: async (query: string, options, ctx) => {
    const client = getClient(ctx);
    if (!client) return [];

    const limit = options?.limit ?? 10;
    ctx.logger.info('Searching linear issues', { query, limit });

    try {
      const filter: Record<string, unknown> = {};
      if (query && query !== '*') {
        filter.title = { containsIgnoreCase: query };
      }
      const result = await client.issues({
        first: limit,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      });
      const issues = result.nodes ?? [];
      ctx.logger.info('Linear search returned results', {
        query,
        resultCount: issues.length,
      });
      const entities = await Promise.all(issues.map(issueToEntity));
      return entities;
    } catch (err) {
      ctx.logger.error('Failed to search linear issues', {
        query,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return [];
    }
  },
});

export default LinearIssueEntity;
