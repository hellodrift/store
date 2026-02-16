import type { DesignMeta, DesignExample } from '../../../apps/canvas/src/canvas/types';
import TicketDrawerContent from './TicketDrawerContent';
import type { TicketDrawerContentProps } from './TicketDrawerContent';

export const meta: DesignMeta<TicketDrawerContentProps> = {
  component: TicketDrawerContent,
  name: 'TicketDrawerContent',
  description: 'Full-featured Linear issue detail panel with properties, sub-issues, relations, and comments.',
  category: 'composed',
  tags: ['plugin', 'linear', 'drawer', 'entity-drawer', 'detail'],
  props: {
    issue: {
      type: 'LinearIssue',
      description: 'Linear issue data to display',
      control: 'object',
    },
    states: {
      type: 'LinearWorkflowState[]',
      description: 'Workflow states for the status dropdown',
      control: 'object',
    },
    members: {
      type: 'LinearUser[]',
      description: 'Team members for the assignee dropdown',
      control: 'object',
    },
    labels: {
      type: 'LinearIssueLabel[]',
      description: 'Available labels for the labels combobox',
      control: 'object',
    },
    projects: {
      type: 'LinearProject[]',
      description: 'Available projects for the project dropdown',
      control: 'object',
    },
    cycles: {
      type: 'LinearCycle[]',
      description: 'Available cycles for the cycle dropdown',
      control: 'object',
    },
    comments: {
      type: 'LinearComment[]',
      description: 'Comments on the issue',
      control: 'object',
    },
    relations: {
      type: 'LinearIssueRelation[]',
      description: 'Issue relations (blocks, blocked by, related, duplicate)',
      control: 'object',
    },
    subIssues: {
      type: 'LinearSubIssue[]',
      description: 'Child issues',
      control: 'object',
    },
    linkedWorkstreams: {
      type: 'LinkedWorkstream[]',
      description: 'Workstreams linked to this entity',
      control: 'object',
    },
    activeWorkstreams: {
      type: 'ActiveWorkstream[]',
      description: 'Available workstreams to link to',
      control: 'object',
    },
    entityUri: {
      type: 'string',
      description: 'Entity URI for linking operations',
      control: 'text',
    },
  },
};

export const Default: DesignExample<TicketDrawerContentProps> = {
  name: 'Default',
  description: 'Full issue with all properties, comments, sub-issue, relation, and linked workstreams',
  args: {
    entityUri: '@drift//linear_issue/issue-1',
    linkedWorkstreams: [
      { id: 'link-1', title: 'Fix SSO authentication', status: 'active', relationship: 'linked' },
    ],
    activeWorkstreams: [
      { id: 'ws-2', title: 'API refactoring sprint', status: 'active' },
      { id: 'ws-3', title: 'Design system overhaul', status: 'paused' },
    ],
    issue: {
      id: 'issue-1',
      title: 'Fix authentication flow for SSO users',
      identifier: 'ENG-142',
      status: 'in_progress',
      stateId: 'state-2',
      stateName: 'In Progress',
      priority: 2,
      priorityLabel: 'High',
      assigneeId: 'user-1',
      assigneeName: 'Sarah Chen',
      teamId: 'team-1',
      teamKey: 'ENG',
      labels: [
        { id: 'label-1', name: 'Bug', color: '#eb5757' },
        { id: 'label-2', name: 'Auth', color: '#4ea7fc' },
      ],
      projectId: 'proj-1',
      projectName: 'Q1 Auth Overhaul',
      cycleId: 'cycle-1',
      cycleName: 'Sprint 14',
      estimate: 5,
      dueDate: '2026-03-01',
      url: 'https://linear.app/drift/issue/ENG-142',
      description: 'SSO users are getting redirected to the wrong callback URL after authentication.\n\nSteps to reproduce:\n1. Go to login page\n2. Click "Sign in with SSO"\n3. Complete authentication\n4. Observe redirect goes to /dashboard instead of the originally requested page',
    },
    comments: [
      {
        id: 'comment-1',
        body: 'I can reproduce this consistently. The redirect URI is being overwritten during the OAuth flow.',
        authorName: 'Alex Kim',
        createdAt: '2026-02-10T14:30:00Z',
      },
      {
        id: 'comment-2',
        body: 'Found the root cause — the state parameter is not being preserved across the SSO redirect. Working on a fix now.',
        authorName: 'Sarah Chen',
        createdAt: '2026-02-11T09:15:00Z',
      },
    ],
    subIssues: [
      {
        id: 'sub-1',
        title: 'Add state parameter to OAuth flow',
        identifier: 'ENG-143',
        status: 'in_progress',
        stateName: 'In Progress',
        priority: 2,
        priorityLabel: 'High',
        assigneeName: 'Sarah Chen',
      },
    ],
    relations: [
      {
        id: 'rel-1',
        type: 'blocks',
        relatedIssueId: 'issue-10',
        relatedIssueIdentifier: 'ENG-150',
        relatedIssueTitle: 'Enable SSO for enterprise customers',
      },
    ],
  },
};

export const Minimal: DesignExample<TicketDrawerContentProps> = {
  name: 'Minimal',
  description: 'Issue with only required fields, no optional data',
  args: {
    issue: {
      id: 'issue-3',
      title: 'Quick bug fix',
      priority: 0,
    },
  },
};

export const WithDescription: DesignExample<TicketDrawerContentProps> = {
  name: 'With Description',
  description: 'Issue with a long multi-line description in a collapsible section',
  args: {
    issue: {
      id: 'issue-4',
      title: 'Migrate database to new schema',
      identifier: 'ENG-180',
      status: 'todo',
      stateId: 'state-1',
      stateName: 'Todo',
      priority: 3,
      priorityLabel: 'Normal',
      assigneeId: 'user-3',
      assigneeName: 'Jordan Lee',
      teamId: 'team-1',
      teamKey: 'ENG',
      estimate: 13,
      dueDate: '2026-04-15',
      description:
        'We need to migrate the existing PostgreSQL schema to support the new multi-tenant architecture.\n\nKey changes:\n- Add tenant_id column to all user-facing tables\n- Create new indexes for tenant-scoped queries\n- Update RLS policies for row-level isolation\n- Run migration in a rolling fashion to avoid downtime\n\nAcceptance criteria:\n- All existing data is preserved\n- Zero downtime during migration\n- Rollback plan documented and tested\n- Performance benchmarks show no regression for single-tenant queries',
    },
  },
};

export const RichData: DesignExample<TicketDrawerContentProps> = {
  name: 'Rich Data',
  description: 'Multiple labels, sub-issues, relations, comments, and multiple linked workstreams',
  args: {
    entityUri: '@drift//linear_issue/issue-5',
    linkedWorkstreams: [
      { id: 'link-2', title: 'Notifications v2 implementation', status: 'ai_working', relationship: 'source' },
      { id: 'link-3', title: 'WebSocket infrastructure', status: 'completed', relationship: 'linked' },
    ],
    activeWorkstreams: [
      { id: 'ws-10', title: 'Mobile push notifications', status: 'active' },
    ],
    issue: {
      id: 'issue-5',
      title: 'Redesign notification system',
      identifier: 'ENG-200',
      status: 'in_progress',
      stateId: 'state-2',
      stateName: 'In Progress',
      priority: 1,
      priorityLabel: 'Urgent',
      assigneeId: 'user-2',
      assigneeName: 'Alex Kim',
      teamId: 'team-1',
      teamKey: 'ENG',
      labels: [
        { id: 'label-1', name: 'Feature', color: '#4ea7fc' },
        { id: 'label-3', name: 'Backend', color: '#f2994a' },
        { id: 'label-4', name: 'Frontend', color: '#6fcf97' },
        { id: 'label-5', name: 'P0', color: '#eb5757' },
      ],
      projectId: 'proj-2',
      projectName: 'Notifications v2',
      cycleId: 'cycle-2',
      cycleName: 'Sprint 15',
      estimate: 21,
      dueDate: '2026-03-15',
      url: 'https://linear.app/drift/issue/ENG-200',
      description: 'Complete overhaul of the notification system to support real-time push, email digests, and in-app notification center.',
    },
    subIssues: [
      {
        id: 'sub-2',
        title: 'Set up WebSocket infrastructure',
        identifier: 'ENG-201',
        status: 'completed',
        stateName: 'Done',
        priority: 1,
        priorityLabel: 'Urgent',
        assigneeName: 'Alex Kim',
      },
      {
        id: 'sub-3',
        title: 'Build notification center UI',
        identifier: 'ENG-202',
        status: 'in_progress',
        stateName: 'In Progress',
        priority: 2,
        priorityLabel: 'High',
        assigneeName: 'Jordan Lee',
      },
      {
        id: 'sub-4',
        title: 'Implement email digest worker',
        identifier: 'ENG-203',
        status: 'todo',
        stateName: 'Todo',
        priority: 3,
        priorityLabel: 'Normal',
      },
      {
        id: 'sub-5',
        title: 'Add notification preferences page',
        identifier: 'ENG-204',
        status: 'todo',
        stateName: 'Backlog',
        priority: 4,
        priorityLabel: 'Low',
        assigneeName: 'Sarah Chen',
      },
    ],
    relations: [
      {
        id: 'rel-2',
        type: 'blocks',
        relatedIssueId: 'issue-20',
        relatedIssueIdentifier: 'ENG-250',
        relatedIssueTitle: 'Mobile push notifications',
      },
      {
        id: 'rel-3',
        type: 'blocked_by',
        relatedIssueId: 'issue-15',
        relatedIssueIdentifier: 'INFRA-42',
        relatedIssueTitle: 'WebSocket gateway deployment',
      },
      {
        id: 'rel-4',
        type: 'related',
        relatedIssueId: 'issue-18',
        relatedIssueIdentifier: 'ENG-175',
        relatedIssueTitle: 'Email template system',
      },
      {
        id: 'rel-5',
        type: 'duplicate',
        relatedIssueId: 'issue-8',
        relatedIssueIdentifier: 'ENG-090',
        relatedIssueTitle: 'Real-time alerts feature request',
      },
    ],
    comments: [
      {
        id: 'comment-3',
        body: 'Kicking off the notification redesign. WebSocket infra is the first priority since everything else depends on it.',
        authorName: 'Alex Kim',
        createdAt: '2026-02-01T10:00:00Z',
      },
      {
        id: 'comment-4',
        body: 'WebSocket gateway is deployed and stable in staging. Moving on to the notification center UI.',
        authorName: 'Alex Kim',
        createdAt: '2026-02-05T16:45:00Z',
      },
      {
        id: 'comment-5',
        body: 'Started on the notification center component. Using the new drawer pattern for the slide-out panel.',
        authorName: 'Jordan Lee',
        createdAt: '2026-02-07T11:30:00Z',
      },
      {
        id: 'comment-6',
        body: 'Quick heads up — the email digest worker will need access to the new template system. Adding a dependency on ENG-175.',
        authorName: 'Sarah Chen',
        createdAt: '2026-02-10T09:00:00Z',
      },
      {
        id: 'comment-7',
        body: 'Updated the estimate to 21 points based on the expanded scope. The preferences page alone is about 5 points.',
        authorName: 'Alex Kim',
        createdAt: '2026-02-12T14:20:00Z',
      },
    ],
  },
};
