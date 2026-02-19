import { DrawerHeaderTitle } from '@drift/ui';
import { useEntityQuery, useEntityMutation, gql, logger, useWorkstreamLinker } from '@drift/plugin-api';
import TicketDrawerContent from './TicketDrawerContent';
import type { LinearIssue, LinearSubIssue } from './TicketDrawerContent';
import { useOptimistic } from './useOptimistic';

// ────────────────────────────────────────────────────────────────────────────
// Priority label map (duplicated from resolvers — kept in sync)
// ────────────────────────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

// ────────────────────────────────────────────────────────────────────────────
// GraphQL Queries
// ────────────────────────────────────────────────────────────────────────────

const GET_LINEAR_ISSUE = gql`
  query GetLinearIssue($id: ID!) {
    linearIssue(id: $id) {
      id
      title
      identifier
      status
      stateId
      stateName
      priority
      priorityLabel
      assigneeId
      assigneeName
      teamId
      teamKey
      labels { id name color }
      projectId
      projectName
      cycleId
      cycleName
      estimate
      dueDate
      url
      description
    }
  }
`;

const GET_WORKFLOW_STATES = gql`
  query GetWorkflowStates($teamId: ID!) {
    linearWorkflowStates(teamId: $teamId) {
      id
      name
      color
      type
    }
  }
`;

const GET_TEAM_MEMBERS = gql`
  query GetTeamMembers($teamId: ID) {
    linearTeamMembers(teamId: $teamId) {
      id
      name
      displayName
      active
    }
  }
`;

const GET_LABELS = gql`
  query GetLabels($teamId: ID) {
    linearLabels(teamId: $teamId) {
      id
      name
      color
    }
  }
`;

const GET_PROJECTS = gql`
  query GetProjects($teamId: ID) {
    linearProjects(teamId: $teamId) {
      id
      name
      status
    }
  }
`;

const GET_CYCLES = gql`
  query GetCycles($teamId: ID!) {
    linearCycles(teamId: $teamId) {
      id
      name
      number
      startsAt
      endsAt
      isActive
    }
  }
`;

const GET_COMMENTS = gql`
  query GetComments($issueId: ID!) {
    linearComments(issueId: $issueId) {
      id
      body
      authorName
      createdAt
      updatedAt
    }
  }
`;

const GET_RELATIONS = gql`
  query GetRelations($issueId: ID!) {
    linearIssueRelations(issueId: $issueId) {
      id
      type
      relatedIssueId
      relatedIssueIdentifier
      relatedIssueTitle
    }
  }
`;

const GET_SUB_ISSUES = gql`
  query GetSubIssues($issueId: ID!) {
    linearSubIssues(issueId: $issueId) {
      id
      title
      identifier
      status
      stateName
      priority
      priorityLabel
      assigneeName
    }
  }
`;

const SEARCH_TEAM_ISSUES = gql`
  query SearchTeamIssues($teamId: ID, $limit: Int) {
    linearIssues(teamId: $teamId, limit: $limit) {
      id
      title
      identifier
    }
  }
`;


// ────────────────────────────────────────────────────────────────────────────
// GraphQL Mutations
// ────────────────────────────────────────────────────────────────────────────

const UPDATE_ISSUE = gql`
  mutation UpdateLinearIssue($id: ID!, $input: UpdateLinearIssueInput!) {
    updateLinearIssue(id: $id, input: $input) {
      success
      message
    }
  }
`;

const ADD_COMMENT = gql`
  mutation AddLinearComment($issueId: ID!, $body: String!) {
    addLinearComment(issueId: $issueId, body: $body) {
      success
      message
    }
  }
`;

const CREATE_LABEL = gql`
  mutation CreateLinearLabel($name: String!, $color: String, $teamId: ID) {
    createLinearLabel(name: $name, color: $color, teamId: $teamId) {
      success
      message
    }
  }
`;

const DELETE_ISSUE = gql`
  mutation DeleteLinearIssue($id: ID!) {
    deleteLinearIssue(id: $id) {
      success
      message
    }
  }
`;

/** Build a canonical entity URI for a Linear issue */
function buildEntityUri(issueId: string): string {
  return `@drift//linear_issue/${issueId}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

interface EntityDrawerProps {
  entityId: string;
  entityType: string;
  label?: string;
  drawer: {
    close: () => void;
    open: (uri: string) => void;
    push: (uri: string) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

export default function TicketDrawer({ entityId, label, drawer }: EntityDrawerProps) {
  // ── Queries ──────────────────────────────────────────────────────────────
  const { data, loading, error, refetch: refetchIssue } = useEntityQuery(GET_LINEAR_ISSUE, {
    variables: { id: entityId },
  });

  const serverIssue: LinearIssue | undefined = data?.linearIssue;
  const teamId = serverIssue?.teamId;

  // Reference data queries — only run once teamId is available
  const { data: statesData } = useEntityQuery(GET_WORKFLOW_STATES, {
    variables: { teamId },
    skip: !teamId,
  });
  const { data: membersData } = useEntityQuery(GET_TEAM_MEMBERS, {
    variables: { teamId },
    skip: !teamId,
  });
  const { data: labelsData, refetch: refetchLabels } = useEntityQuery(GET_LABELS, {
    variables: { teamId },
    skip: !teamId,
  });
  const { data: projectsData } = useEntityQuery(GET_PROJECTS, {
    variables: { teamId },
    skip: !teamId,
  });
  const { data: cyclesData } = useEntityQuery(GET_CYCLES, {
    variables: { teamId },
    skip: !teamId,
  });

  // Issue-specific data
  const { data: commentsData, refetch: refetchComments } = useEntityQuery(GET_COMMENTS, {
    variables: { issueId: entityId },
  });
  const { data: relationsData } = useEntityQuery(GET_RELATIONS, {
    variables: { issueId: entityId },
  });
  const { data: subIssuesData, refetch: refetchSubIssues } = useEntityQuery(GET_SUB_ISSUES, {
    variables: { issueId: entityId },
  });

  const { data: teamIssuesData, refetch: refetchTeamIssues } = useEntityQuery(SEARCH_TEAM_ISSUES, {
    variables: { teamId, limit: 100 },
    skip: !teamId,
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const [updateIssue] = useEntityMutation(UPDATE_ISSUE);
  const [addComment] = useEntityMutation(ADD_COMMENT);
  const [createLabel] = useEntityMutation(CREATE_LABEL);
  const [deleteIssue] = useEntityMutation(DELETE_ISSUE);
  // ── Workstream linking (via SDK hook) ────────────────────────────────
  const entityUri = buildEntityUri(entityId);
  const workstreamLinker = useWorkstreamLinker(entityUri, 'linear_issue');

  // ── Optimistic state ────────────────────────────────────────────────────
  const optimistic = useOptimistic<LinearIssue>(serverIssue);
  const issue = optimistic.data;

  interface SubIssuesState { subIssues: LinearSubIssue[]; }
  const serverSubIssues: LinearSubIssue[] = subIssuesData?.linearSubIssues ?? [];
  const optimisticSubIssues = useOptimistic<SubIssuesState>({ subIssues: serverSubIssues });
  const subIssues = optimisticSubIssues.data?.subIssues ?? serverSubIssues;

  // ── Derived-field resolver ──────────────────────────────────────────────
  // Maps a single API field change to ALL display fields that should update
  // immediately. Without this, changing stateId would leave stateName stale
  // until the refetch completes.
  function deriveUpdates(field: string, value: unknown): Partial<LinearIssue> {
    switch (field) {
      case 'title':
        return { title: value as string };

      case 'stateId': {
        const state = statesData?.linearWorkflowStates?.find(
          (s: any) => s.id === value,
        );
        return {
          stateId: value as string,
          stateName: state?.name,
          status: state?.name?.toLowerCase().replace(/\s+/g, '_'),
        };
      }

      case 'priority': {
        const p = value as number;
        return { priority: p, priorityLabel: PRIORITY_LABELS[p] ?? 'Unknown' };
      }

      case 'assigneeId': {
        if (!value) return { assigneeId: undefined, assigneeName: undefined };
        const member = membersData?.linearTeamMembers?.find(
          (m: any) => m.id === value,
        );
        return {
          assigneeId: value as string,
          assigneeName: member?.displayName || member?.name,
        };
      }

      case 'labelIds': {
        const ids = value as string[];
        const all = labelsData?.linearLabels ?? [];
        const selected = ids
          .map((id: string) => all.find((l: any) => l.id === id))
          .filter(Boolean);
        return { labels: selected };
      }

      case 'projectId': {
        if (!value) return { projectId: undefined, projectName: undefined };
        const project = projectsData?.linearProjects?.find(
          (p: any) => p.id === value,
        );
        return { projectId: value as string, projectName: project?.name };
      }

      case 'cycleId': {
        if (!value) return { cycleId: undefined, cycleName: undefined };
        const cycle = cyclesData?.linearCycles?.find(
          (c: any) => c.id === value,
        );
        return {
          cycleId: value as string,
          cycleName: cycle?.name || `Cycle ${cycle?.number}`,
        };
      }

      case 'estimate':
        return { estimate: value as number | undefined };

      case 'dueDate':
        return { dueDate: value as string | undefined };

      default:
        return { [field]: value } as Partial<LinearIssue>;
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleUpdateField = (field: string, value: unknown) => {
    const updates = deriveUpdates(field, value);

    optimistic.apply(updates, async () => {
      await updateIssue({ variables: { id: entityId, input: { [field]: value } } });
      await refetchIssue();
    });
  };

  const handleAddComment = async (body: string) => {
    try {
      await addComment({ variables: { issueId: entityId, body } });
      refetchComments();
    } catch (err: any) {
      logger.error('Failed to add comment', { error: err?.message });
    }
  };

  const handleCreateLabel = async (name: string) => {
    try {
      await createLabel({ variables: { name, teamId } });
      refetchLabels();
    } catch (err: any) {
      logger.error('Failed to create label', { error: err?.message });
    }
  };

  const handleDeleteIssue = async () => {
    optimistic.apply({}, async () => {
      await deleteIssue({ variables: { id: entityId } });
      drawer.close();
    });
  };

  const handleAddSubIssue = (childId: string) => {
    const teamIssue = teamIssuesData?.linearIssues?.find((i: any) => i.id === childId);
    const optimisticEntry: LinearSubIssue = {
      id: childId,
      title: teamIssue?.title ?? childId,
      identifier: teamIssue?.identifier,
    };
    optimisticSubIssues.apply(
      { subIssues: [...subIssues, optimisticEntry] },
      async () => {
        await updateIssue({ variables: { id: childId, input: { parentId: entityId } } });
        await refetchSubIssues();
        refetchTeamIssues();
      },
    );
  };

  const handleRemoveSubIssue = (childId: string) => {
    optimisticSubIssues.apply(
      { subIssues: subIssues.filter((s) => s.id !== childId) },
      async () => {
        await updateIssue({ variables: { id: childId, input: { parentId: null } } });
        await refetchSubIssues();
        refetchTeamIssues();
      },
    );
  };

  const handleOpenEntity = (uri: string) => {
    drawer.push(uri);
  };


  // ── Render ───────────────────────────────────────────────────────────────

  if (loading && !serverIssue) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
          Loading issue...
        </div>
      </div>
    );
  }

  if (error && !serverIssue) {
    logger.error('Failed to load Linear issue', { entityId, error: error.message });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
          Failed to load issue: {error.message}
        </div>
      </div>
    );
  }

  if (!issue) {
    return (
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
        Issue not found
      </div>
    );
  }

  return (
    <TicketDrawerContent
      issue={issue}
      states={statesData?.linearWorkflowStates}
      members={membersData?.linearTeamMembers}
      labels={labelsData?.linearLabels}
      projects={projectsData?.linearProjects}
      cycles={cyclesData?.linearCycles}
      comments={commentsData?.linearComments}
      relations={relationsData?.linearIssueRelations}
      subIssues={subIssues}
      teamIssues={teamIssuesData?.linearIssues}
      onAddSubIssue={handleAddSubIssue}
      onRemoveSubIssue={handleRemoveSubIssue}
      onDeleteIssue={handleDeleteIssue}
      onUpdateField={handleUpdateField}
      onAddComment={handleAddComment}
      onCreateLabel={handleCreateLabel}
      onOpenEntity={handleOpenEntity}
      error={optimistic.error}
      onDismissError={optimistic.dismissError}
      entityUri={entityUri}
      linkedWorkstreams={workstreamLinker.linkedWorkstreams}
      activeWorkstreams={workstreamLinker.activeWorkstreams}
      onLinkWorkstream={workstreamLinker.linkWorkstream}
      onUnlinkWorkstream={workstreamLinker.unlinkWorkstream}
      onStartWorkstream={(_id, title) => workstreamLinker.startWorkstream(title)}
      onClickWorkstream={(ws) => { workstreamLinker.navigateToWorkstream(ws); drawer.close(); }}
    />
  );
}
