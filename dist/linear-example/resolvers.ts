/**
 * Linear GraphQL Resolvers
 *
 * Implements Query and Mutation resolvers for LinearIssue.
 * Uses the Linear SDK client via resolver context injection.
 *
 * Context shape (injected by EntitySchemaRegistry):
 *   ctx.integrations.linear.client — LinearClient instance
 *   ctx.logger — scoped logger
 */

// Priority label map
const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

// Helper: get Linear client from context
function getClient(ctx: any): any | null {
  return ctx.integrations?.linear?.client ?? null;
}

// Helper: convert Linear SDK issue to GraphQL LinearIssue
async function issueToEntity(issue: any): Promise<any> {
  const state = issue._state ? await issue.state : undefined;

  let assigneeName: string | undefined;
  if (issue._assignee) {
    try {
      const assignee = await issue.assignee;
      assigneeName = assignee?.name ?? assignee?.displayName;
    } catch {
      // assignee resolution failed
    }
  }

  let teamName: string | undefined;
  let teamKey: string | undefined;
  if (issue._team) {
    try {
      const team = await issue.team;
      teamName = team?.name;
      teamKey = team?.key;
    } catch {
      // team resolution failed
    }
  }

  let labels: { id: string; name: string; color: string }[] | undefined;
  let labelNames: string | undefined;
  try {
    const labelsConn = await issue.labels();
    if (labelsConn?.nodes?.length) {
      labels = labelsConn.nodes.map((l: any) => ({
        id: l.id,
        name: l.name,
        color: l.color ?? '',
      }));
      labelNames = labels!.map((l) => l.name).join(', ');
    }
  } catch {
    // labels resolution failed
  }

  let projectId: string | undefined;
  let projectName: string | undefined;
  try {
    const project = await issue.project;
    if (project) {
      projectId = project.id;
      projectName = project.name;
    }
  } catch {
    // project resolution failed
  }

  let cycleId: string | undefined;
  let cycleName: string | undefined;
  try {
    const cycle = await issue.cycle;
    if (cycle) {
      cycleId = cycle.id;
      cycleName = cycle.name ?? cycle.number?.toString();
    }
  } catch {
    // cycle resolution failed
  }

  let parentId: string | undefined;
  try {
    const parent = await issue.parent;
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
    createdAt: issue.createdAt?.toISOString?.() ?? issue.createdAt,
    updatedAt: issue.updatedAt?.toISOString?.() ?? issue.updatedAt,
  };
}

// GraphQL Resolvers
export default {
  LinearIssue: {
    linkedContext: async (parent: any, _args: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client || !parent.id) return null;

      try {
        const issue = await client.issue(parent.id);
        const state = await issue.state;
        let assigneeName: string | undefined;
        try {
          const assignee = await issue.assignee;
          assigneeName = assignee?.name ?? assignee?.displayName;
        } catch {
          // assignee resolution failed
        }

        const lines = [
          `## Linear Issue: ${issue.title}`,
          `- **Identifier**: ${issue.identifier}`,
          `- **Status**: ${state?.name ?? 'Unknown'}`,
          `- **Priority**: ${PRIORITY_LABELS[issue.priority ?? 0] ?? 'None'}`,
          `- **Assignee**: ${assigneeName ?? 'Unassigned'}`,
        ];

        if (issue.dueDate) {
          lines.push(`- **Due Date**: ${issue.dueDate}`);
        }

        if (issue.description) {
          lines.push('', `### Description`, issue.description);
        }

        return lines.join('\n');
      } catch (err: any) {
        ctx.logger.error('Failed to resolve linkedContext for LinearIssue', {
          issueId: parent.id,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },
  },

  Query: {
    linearIssue: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return null;

      ctx.logger.info('Resolving linear issue via GraphQL', { issueId: id });

      try {
        const issue = await client.issue(id);
        return await issueToEntity(issue);
      } catch (err: any) {
        ctx.logger.error('Failed to resolve linear issue', {
          issueId: id,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },

    linearWorkflowStates: async (
      _: unknown,
      { teamId }: { teamId: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const team = await client.team(teamId);
        const states = await team.states();
        const typeOrder: Record<string, number> = {
          backlog: 0,
          unstarted: 1,
          started: 2,
          completed: 3,
          cancelled: 4,
        };
        return (states.nodes ?? [])
          .map((s: any) => ({
            id: s.id,
            name: s.name,
            color: s.color ?? '',
            type: s.type ?? '',
          }))
          .sort(
            (a: any, b: any) =>
              (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99),
          );
      } catch (err: any) {
        ctx.logger.error('Failed to resolve workflow states', {
          teamId,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    linearTeamMembers: async (
      _: unknown,
      { teamId }: { teamId?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        let members;
        if (teamId) {
          const team = await client.team(teamId);
          members = await team.members();
        } else {
          members = await client.users();
        }
        return (members.nodes ?? []).map((u: any) => ({
          id: u.id,
          name: u.name,
          displayName: u.displayName ?? null,
          email: u.email ?? null,
          active: u.active ?? true,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to resolve team members', {
          teamId,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    linearLabels: async (
      _: unknown,
      { teamId }: { teamId?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        let labels;
        if (teamId) {
          const team = await client.team(teamId);
          labels = await team.labels();
        } else {
          labels = await client.issueLabels();
        }
        return (labels.nodes ?? []).map((l: any) => ({
          id: l.id,
          name: l.name,
          color: l.color ?? '',
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to resolve labels', {
          teamId,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    linearTeams: async (_: unknown, __: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const teams = await client.teams();
        return (teams.nodes ?? []).map((t: any) => ({
          id: t.id,
          name: t.name,
          key: t.key,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to resolve teams', {
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    linearProjects: async (
      _: unknown,
      { teamId }: { teamId?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        let projects;
        if (teamId) {
          const team = await client.team(teamId);
          projects = await team.projects();
        } else {
          projects = await client.projects();
        }
        return (projects.nodes ?? []).map((p: any) => ({
          id: p.id,
          name: p.name,
          status: p.state ?? null,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to resolve projects', {
          teamId,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    linearCycles: async (
      _: unknown,
      { teamId }: { teamId: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const team = await client.team(teamId);
        const cycles = await team.cycles();
        return (cycles.nodes ?? []).map((c: any) => ({
          id: c.id,
          name: c.name ?? null,
          number: c.number ?? 0,
          startsAt: c.startsAt?.toISOString?.() ?? c.startsAt ?? null,
          endsAt: c.endsAt?.toISOString?.() ?? c.endsAt ?? null,
          isActive:
            c.startsAt && c.endsAt
              ? new Date(c.startsAt) <= new Date() &&
                new Date() <= new Date(c.endsAt)
              : false,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to resolve cycles', {
          teamId,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    linearComments: async (
      _: unknown,
      { issueId }: { issueId: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const issue = await client.issue(issueId);
        const comments = await issue.comments();
        const results = await Promise.all(
          (comments.nodes ?? []).map(async (c: any) => {
            let authorName: string | undefined;
            try {
              const user = await c.user;
              authorName = user?.name ?? user?.displayName;
            } catch {
              // author resolution failed
            }
            return {
              id: c.id,
              body: c.body ?? '',
              authorName: authorName ?? null,
              createdAt: c.createdAt?.toISOString?.() ?? c.createdAt ?? '',
              updatedAt: c.updatedAt?.toISOString?.() ?? c.updatedAt ?? null,
            };
          }),
        );
        return results;
      } catch (err: any) {
        ctx.logger.error('Failed to resolve comments', {
          issueId,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    linearIssueRelations: async (
      _: unknown,
      { issueId }: { issueId: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const issue = await client.issue(issueId);
        const relations = await issue.relations();
        const results = await Promise.all(
          (relations.nodes ?? []).map(async (r: any) => {
            let relatedIssueIdentifier: string | undefined;
            let relatedIssueTitle: string | undefined;
            try {
              const related = await r.relatedIssue;
              relatedIssueIdentifier = related?.identifier;
              relatedIssueTitle = related?.title;
            } catch {
              // related issue resolution failed
            }
            return {
              id: r.id,
              type: r.type ?? '',
              relatedIssueId: r._relatedIssue?.id ?? '',
              relatedIssueIdentifier: relatedIssueIdentifier ?? null,
              relatedIssueTitle: relatedIssueTitle ?? null,
            };
          }),
        );
        return results;
      } catch (err: any) {
        ctx.logger.error('Failed to resolve issue relations', {
          issueId,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    linearSubIssues: async (
      _: unknown,
      { issueId }: { issueId: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const issue = await client.issue(issueId);
        const children = await issue.children();
        const results = await Promise.all(
          (children.nodes ?? []).map(async (child: any) => {
            let stateName: string | undefined;
            let status: string | undefined;
            try {
              const state = await child.state;
              stateName = state?.name;
              status = state?.name?.toLowerCase().replace(/\s+/g, '_');
            } catch {
              // state resolution failed
            }
            let assigneeName: string | undefined;
            try {
              const assignee = await child.assignee;
              assigneeName = assignee?.name ?? assignee?.displayName;
            } catch {
              // assignee resolution failed
            }
            const priority = child.priority ?? 0;
            return {
              id: child.id,
              title: child.title,
              identifier: child.identifier ?? null,
              status: status ?? null,
              stateName: stateName ?? null,
              priority,
              priorityLabel: PRIORITY_LABELS[priority] ?? 'Unknown',
              assigneeName: assigneeName ?? null,
            };
          }),
        );
        return results;
      } catch (err: any) {
        ctx.logger.error('Failed to resolve sub-issues', {
          issueId,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    linearIssues: async (
      _: unknown,
      { query, teamId, limit, assignmentFilter, statusTypes }: {
        query?: string;
        teamId?: string;
        limit?: number;
        assignmentFilter?: string;
        statusTypes?: string[];
      },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) {
        ctx.logger.warn('linearIssues: no Linear client available, returning empty');
        return [];
      }

      const maxResults = limit ?? 10;
      ctx.logger.info('Searching linear issues via GraphQL', {
        query, teamId, limit: maxResults, assignmentFilter, statusTypes,
      });

      try {
        const filter: Record<string, unknown> = {};
        if (query && query !== '*') {
          filter.title = { containsIgnoreCase: query };
        }
        if (teamId) {
          filter.team = { id: { eq: teamId } };
        }
        if (assignmentFilter === 'assigned_to_me') {
          filter.assignee = { isMe: { eq: true } };
        } else if (assignmentFilter === 'created_by_me') {
          filter.creator = { isMe: { eq: true } };
        }
        if (statusTypes?.length) {
          filter.state = { type: { in: statusTypes } };
        }
        const result = await client.issues({
          first: maxResults,
          filter: Object.keys(filter).length > 0 ? filter : undefined,
        });
        const nodes = result.nodes ?? [];
        ctx.logger.info('Linear API returned issues', { count: nodes.length });
        return await Promise.all(nodes.map(issueToEntity));
      } catch (err: any) {
        ctx.logger.error('Failed to search linear issues', {
          query,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },
  },

  Mutation: {
    createLinearIssue: async (_: unknown, { input }: { input: any }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) {
        return { success: false, message: 'No API token configured' };
      }

      ctx.logger.info('Creating Linear issue via GraphQL', {
        title: input.title,
        teamId: input.teamId,
      });

      try {
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
        if (!issue) {
          return { success: false, message: 'Issue creation returned no result' };
        }

        const entity = await issueToEntity(issue);
        return {
          success: true,
          message: `Created issue ${issue.identifier}: ${issue.title}`,
          entity,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to create issue: ${err?.message ?? String(err)}`,
        };
      }
    },

    updateLinearIssue: async (
      _: unknown,
      { id, input }: { id: string; input: any },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) {
        return { success: false, message: 'No API token configured' };
      }

      ctx.logger.info('Updating Linear issue via GraphQL', { issueId: id });

      try {
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
        if (input.parentId !== undefined) updateData.parentId = input.parentId;

        const payload = await client.updateIssue(id, updateData);
        const issue = await payload.issue;
        if (!issue) {
          return { success: false, message: 'Issue update returned no result' };
        }

        const entity = await issueToEntity(issue);
        return {
          success: true,
          message: `Updated issue ${issue.identifier}`,
          entity,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to update issue: ${err?.message ?? String(err)}`,
        };
      }
    },

    deleteLinearIssue: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) {
        return { success: false, message: 'No API token configured' };
      }

      ctx.logger.info('Deleting Linear issue via GraphQL', { issueId: id });

      try {
        const payload = await client.deleteIssue(id);
        return {
          success: payload.success,
          message: payload.success
            ? `Deleted issue ${id}`
            : `Failed to delete issue ${id}`,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to delete issue: ${err?.message ?? String(err)}`,
        };
      }
    },

    addLinearComment: async (
      _: unknown,
      { issueId, body }: { issueId: string; body: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) {
        return { success: false, message: 'No API token configured' };
      }

      ctx.logger.info('Adding comment to Linear issue', { issueId });

      try {
        const payload = await client.createComment({ issueId, body });
        const comment = await payload.comment;
        return {
          success: true,
          message: comment
            ? `Added comment to issue`
            : 'Comment created but no result returned',
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to add comment: ${err?.message ?? String(err)}`,
        };
      }
    },

    createLinearLabel: async (
      _: unknown,
      { name, color, teamId }: { name: string; color?: string; teamId?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) {
        return { success: false, message: 'No API token configured' };
      }

      ctx.logger.info('Creating Linear label', { name, teamId });

      try {
        const input: Record<string, unknown> = { name };
        if (color) input.color = color;
        if (teamId) input.teamId = teamId;
        const payload = await client.createIssueLabel(input);
        const label = await payload.issueLabel;
        return {
          success: true,
          message: label
            ? `Created label "${label.name}"`
            : `Created label "${name}"`,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to create label: ${err?.message ?? String(err)}`,
        };
      }
    },
  },
};
