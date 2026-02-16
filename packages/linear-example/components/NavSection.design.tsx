import type { DesignMeta, DesignExample } from '../../../apps/canvas/src/canvas/types';
import { NavSection, NavItem } from '@drift/ui/components';
import { LinearIcon } from '@drift/ui/components';
import type { ReactNode } from 'react';

interface LinearIssue {
  id: string;
  title: string;
  identifier: string;
  priority: number;
  priorityLabel: string;
  stateName?: string;
}

const priorityColors: Record<number, string> = {
  1: 'var(--status-error)',
  2: 'var(--status-warning)',
  3: 'var(--text-secondary)',
  4: 'var(--text-muted)',
};

interface LinearNavPreviewProps {
  issues: LinearIssue[];
  loading: boolean;
  error: string | null;
}

function LinearNavPreview({ issues, loading, error }: LinearNavPreviewProps) {
  const section = {
    id: 'linear-issues',
    label: `Linear${issues.length ? ` (${issues.length})` : ''}`,
    icon: <LinearIcon size={12} />,
    items: [],
    isLoading: loading,
    emptyState: error || 'No issues found',
  };

  return (
    <NavSection section={section}>
      {issues.map((issue) => (
        <NavItem
          key={issue.id}
          item={{
            id: issue.id,
            label: issue.title || '(No title)',
            variant: 'item' as const,
            meta: (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                {issue.priority > 0 && (
                  <span style={{ color: priorityColors[issue.priority] || 'var(--text-muted)', fontWeight: 600 }}>
                    P{issue.priority}
                  </span>
                )}
                <span>{issue.identifier}</span>
              </span>
            ),
          }}
        />
      ))}
    </NavSection>
  );
}

export const meta: DesignMeta<LinearNavPreviewProps> = {
  component: LinearNavPreview,
  name: 'LinearNav',
  description: 'Navigation section showing Linear issues with priority indicators.',
  category: 'composed',
  tags: ['plugin', 'linear', 'nav', 'sidebar'],
  props: {
    issues: {
      type: 'LinearIssue[]',
      description: 'Array of Linear issues to display',
      control: 'object',
      default: [],
    },
    loading: {
      type: 'boolean',
      description: 'Show loading skeleton state',
      control: 'boolean',
      default: false,
    },
    error: {
      type: 'string | null',
      description: 'Error message to display',
      control: 'text',
      default: null,
    },
  },
};

const mockIssues: LinearIssue[] = [
  { id: '1', title: 'Fix authentication flow', identifier: 'ENG-142', priority: 2, priorityLabel: 'High', stateName: 'In Progress' },
  { id: '2', title: 'Add dark mode support', identifier: 'ENG-138', priority: 3, priorityLabel: 'Normal', stateName: 'Todo' },
  { id: '3', title: 'Update onboarding copy', identifier: 'ENG-155', priority: 4, priorityLabel: 'Low', stateName: 'Backlog' },
];

export const Default: DesignExample<LinearNavPreviewProps> = {
  name: 'Default',
  description: 'Three issues with mixed priorities',
  args: { issues: mockIssues, loading: false, error: null },
};

export const Loading: DesignExample<LinearNavPreviewProps> = {
  name: 'Loading',
  description: 'Loading skeleton state',
  args: { issues: [], loading: true, error: null },
};

export const Empty: DesignExample<LinearNavPreviewProps> = {
  name: 'Empty',
  description: 'No issues found',
  args: { issues: [], loading: false, error: null },
};

export const Error: DesignExample<LinearNavPreviewProps> = {
  name: 'Error',
  description: 'Error state with message',
  args: { issues: [], loading: false, error: 'Failed to connect to Linear API' },
};

export const AllPriorities: DesignExample<LinearNavPreviewProps> = {
  name: 'All Priorities',
  description: 'Issues showing every priority level (P1-P4)',
  args: {
    issues: [
      { id: '1', title: 'Production outage in auth service', identifier: 'ENG-200', priority: 1, priorityLabel: 'Urgent' },
      { id: '2', title: 'Fix authentication flow', identifier: 'ENG-142', priority: 2, priorityLabel: 'High' },
      { id: '3', title: 'Add dark mode support', identifier: 'ENG-138', priority: 3, priorityLabel: 'Normal' },
      { id: '4', title: 'Update onboarding copy', identifier: 'ENG-155', priority: 4, priorityLabel: 'Low' },
    ],
    loading: false,
    error: null,
  },
};

export const ManyIssues: DesignExample<LinearNavPreviewProps> = {
  name: 'Many Issues',
  description: 'Large list of issues demonstrating scrollable content',
  args: {
    issues: Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      title: [
        'Implement user settings page',
        'Fix memory leak in WebSocket handler',
        'Add CSV export for reports',
        'Migrate database to new schema',
        'Update API rate limiting',
        'Fix sidebar collapse animation',
        'Add keyboard shortcuts help modal',
        'Refactor notification system',
        'Fix timezone handling in scheduler',
        'Add bulk actions to issue list',
        'Improve search result ranking',
        'Add audit log viewer',
      ][i],
      identifier: `ENG-${100 + i}`,
      priority: (i % 4) + 1,
      priorityLabel: ['Urgent', 'High', 'Normal', 'Low'][i % 4],
    })),
    loading: false,
    error: null,
  },
};
