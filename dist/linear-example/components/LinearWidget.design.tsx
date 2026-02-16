import type { DesignMeta, DesignExample } from '../../../apps/canvas/src/canvas/types';

/**
 * Presentational wrapper for LinearWidget design previews.
 * The real component uses useEntityQuery which isn't available in the canvas,
 * so we render the chip/card UI directly with mock data.
 */

interface LinearIssue {
  id: string;
  identifier?: string;
  title: string;
  status?: string;
  stateName?: string;
  priority: number;
  priorityLabel?: string;
  assigneeName?: string;
  teamKey?: string;
  url?: string;
}

const priorityColors: Record<number, string> = {
  1: 'var(--status-error, #e5484d)',
  2: 'var(--status-warning, #e5933a)',
  3: 'var(--text-secondary, #8b8d98)',
  4: 'var(--text-muted, #6e6f78)',
};

interface DesignWidgetProps {
  issue?: LinearIssue;
  compact: boolean;
  loading?: boolean;
  error?: string;
}

function LinearChip({ issue, loading }: { issue?: LinearIssue; loading?: boolean }) {
  if (loading) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '1px 6px',
          borderRadius: '4px',
          fontSize: '12px',
          background: 'var(--surface-subtle)',
          color: 'var(--text-muted)',
        }}
      >
        Loading...
      </span>
    );
  }

  if (!issue) return null;

  const priorityColor = priorityColors[issue.priority];
  const displayText = issue.identifier
    ? `${issue.identifier} · ${issue.title}`
    : issue.title;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '1px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: 500,
        background: '#5E6AD2',
        color: '#fff',
        borderLeft: priorityColor ? `3px solid ${priorityColor}` : undefined,
        maxWidth: '300px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {displayText}
    </span>
  );
}

function LinearCard({ issue, loading, error }: { issue?: LinearIssue; loading?: boolean; error?: string }) {
  if (loading) {
    return (
      <div
        style={{
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid var(--border-muted)',
          background: 'var(--surface-subtle)',
        }}
      >
        <div style={{ height: '14px', width: '80px', borderRadius: '4px', background: 'var(--surface-hover)', marginBottom: '8px' }} />
        <div style={{ height: '12px', width: '200px', borderRadius: '4px', background: 'var(--surface-hover)' }} />
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div
        style={{
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid var(--border-muted)',
          background: 'var(--surface-subtle)',
          color: 'var(--text-muted)',
          fontSize: '12px',
        }}
      >
        {error || 'Issue not found'}
      </div>
    );
  }

  const priorityColor = priorityColors[issue.priority] || 'var(--text-muted)';

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        borderTop: '1px solid var(--border-muted)',
        borderRight: '1px solid var(--border-muted)',
        borderBottom: '1px solid var(--border-muted)',
        borderLeft: `3px solid ${priorityColor}`,
        background: 'var(--surface-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#5E6AD2' }}>
          {issue.identifier || issue.id}
        </span>
        {issue.stateName && (
          <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'var(--surface-hover)', color: 'var(--text-secondary)', fontWeight: 500 }}>
            {issue.stateName}
          </span>
        )}
      </div>
      <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '8px', lineHeight: 1.3 }}>
        {issue.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
        {issue.priorityLabel && <span style={{ color: priorityColor, fontWeight: 600 }}>{issue.priorityLabel}</span>}
        {issue.assigneeName && <span>{issue.assigneeName}</span>}
        {issue.teamKey && <span>{issue.teamKey}</span>}
        {issue.url && (
          <a href={issue.url} target="_blank" rel="noopener noreferrer" style={{ color: '#5E6AD2', textDecoration: 'none', marginLeft: 'auto' }}>
            Open in Linear
          </a>
        )}
      </div>
    </div>
  );
}

function LinearWidgetDesign({ issue, compact, loading, error }: DesignWidgetProps) {
  if (compact) {
    return <LinearChip issue={issue} loading={loading} />;
  }
  return <LinearCard issue={issue} loading={loading} error={error} />;
}

export const meta: DesignMeta<DesignWidgetProps> = {
  component: LinearWidgetDesign,
  name: 'LinearWidget',
  description: 'Entity widget for rendering linear_issue entities as inline chips or block cards in chat messages.',
  category: 'composed',
  tags: ['plugin', 'linear', 'entity-widget', 'chip', 'card'],
  props: {
    issue: {
      type: 'LinearIssue | undefined',
      description: 'Issue data to render',
      control: 'object',
    },
    compact: {
      type: 'boolean',
      description: 'true = inline chip, false = block card',
      control: 'boolean',
    },
    loading: {
      type: 'boolean',
      description: 'Show loading state',
      control: 'boolean',
    },
    error: {
      type: 'string | undefined',
      description: 'Error message to display',
      control: 'text',
    },
  },
};

const defaultIssue: LinearIssue = {
  id: 'issue-1',
  identifier: 'ENG-142',
  title: 'Fix authentication flow for SSO users',
  status: 'in_progress',
  stateName: 'In Progress',
  priority: 2,
  priorityLabel: 'High',
  assigneeName: 'Sarah Chen',
  teamKey: 'ENG',
  url: 'https://linear.app/drift/issue/ENG-142',
};

export const ChipDefault: DesignExample<DesignWidgetProps> = {
  name: 'Chip Default',
  description: 'Compact inline chip with identifier and title',
  args: {
    issue: defaultIssue,
    compact: true,
  },
};

export const ChipLoading: DesignExample<DesignWidgetProps> = {
  name: 'Chip Loading',
  description: 'Loading shimmer state for inline chip',
  args: {
    compact: true,
    loading: true,
  },
};

export const CardDefault: DesignExample<DesignWidgetProps> = {
  name: 'Card Default',
  description: 'Full card with all metadata fields',
  args: {
    issue: defaultIssue,
    compact: false,
  },
};

export const CardUrgent: DesignExample<DesignWidgetProps> = {
  name: 'Card Urgent',
  description: 'P1 urgent priority card with red indicator',
  args: {
    issue: {
      id: 'issue-2',
      identifier: 'ENG-200',
      title: 'Production outage in auth service',
      status: 'in_progress',
      stateName: 'In Progress',
      priority: 1,
      priorityLabel: 'Urgent',
      assigneeName: 'Alex Kim',
      teamKey: 'INFRA',
      url: 'https://linear.app/drift/issue/ENG-200',
    },
    compact: false,
  },
};

export const CardLoading: DesignExample<DesignWidgetProps> = {
  name: 'Card Loading',
  description: 'Skeleton loading state for block card',
  args: {
    compact: false,
    loading: true,
  },
};

export const CardMinimal: DesignExample<DesignWidgetProps> = {
  name: 'Card Minimal',
  description: 'Card with only id and title, no optional fields',
  args: {
    issue: {
      id: 'issue-3',
      title: 'Quick bug fix',
      priority: 0,
    },
    compact: false,
  },
};
