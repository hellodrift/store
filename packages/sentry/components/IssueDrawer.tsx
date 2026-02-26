import { useState } from 'react';
import {
  DrawerHeaderTitle,
  DrawerHeaderActions,
  DrawerBody,
  ContentSection,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Combobox,
  Button,
  Separator,
  WorkstreamHeaderAction,
  WorkstreamSection,
  type LinkedWorkstream,
  type ActiveWorkstream,
} from '@drift/ui';
import { useEntityQuery, useEntityMutation, gql, logger, useWorkstreamLinker, openExternal } from '@drift/plugin-api';

// ── GraphQL ──────────────────────────────────────────────────────────────────

const GET_ISSUE = gql`
  query GetSentryIssue($id: String!) {
    sentryIssue(id: $id) {
      id
      shortId
      title
      culprit
      level
      status
      substatus
      platform
      count
      userCount
      firstSeen
      lastSeen
      permalink
      isBookmarked
      project { id slug name platform }
      assignedTo { type id name email }
      metadata { type value filename function }
    }
  }
`;

const GET_EVENTS = gql`
  query GetSentryIssueEvents($issueId: String!, $limit: Int) {
    sentryIssueEvents(issueId: $issueId, limit: $limit) {
      eventID
      id
      title
      dateCreated
      platform
      environment
      tags { key value }
      user { id email ipAddress }
    }
  }
`;

const GET_LATEST_EVENT = gql`
  query GetSentryLatestEvent($issueId: String!) {
    sentryLatestEvent(issueId: $issueId) {
      eventID
      title
      dateCreated
      platform
      culprit
      environment
      tags { key value }
      entries { type data }
      contexts
      user { id email username ipAddress }
      release { version }
    }
  }
`;

const GET_MEMBERS = gql`
  query GetSentryMembers {
    sentryMembers {
      id
      name
      email
    }
  }
`;

const RESOLVE_ISSUE = gql`
  mutation SentryResolveIssue($id: String!) {
    sentryResolveIssue(id: $id) { success message }
  }
`;

const UNRESOLVE_ISSUE = gql`
  mutation SentryUnresolveIssue($id: String!) {
    sentryUnresolveIssue(id: $id) { success message }
  }
`;

const IGNORE_ISSUE = gql`
  mutation SentryIgnoreIssue($id: String!, $ignoreDuration: Int) {
    sentryIgnoreIssue(id: $id, ignoreDuration: $ignoreDuration) { success message }
  }
`;

const ASSIGN_ISSUE = gql`
  mutation SentryAssignIssue($id: String!, $assignedTo: String!) {
    sentryAssignIssue(id: $id, assignedTo: $assignedTo) { success message }
  }
`;

const UNASSIGN_ISSUE = gql`
  mutation SentryUnassignIssue($id: String!) {
    sentryUnassignIssue(id: $id) { success message }
  }
`;

// ── Types ────────────────────────────────────────────────────────────────────

interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  level: string;
  status: string;
  substatus?: string;
  platform?: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  isBookmarked: boolean;
  project: { id: string; slug: string; name: string; platform?: string };
  assignedTo?: { type: string; id: string; name: string; email?: string } | null;
  metadata?: { type?: string; value?: string; filename?: string; function?: string } | null;
}

interface SentryEvent {
  eventID: string;
  id: string;
  title: string;
  dateCreated: string;
  platform?: string;
  culprit?: string;
  environment?: string;
  tags?: Array<{ key: string; value: string }>;
  entries?: Array<{ type: string; data: any }>;
  contexts?: Record<string, any>;
  user?: { id?: string; email?: string; username?: string; ipAddress?: string } | null;
  release?: { version: string } | null;
}

interface Breadcrumb {
  type?: string;
  category?: string;
  message?: string;
  level?: string;
  timestamp?: string;
  data?: Record<string, any>;
}

interface SentryMember {
  id: string;
  name: string;
  email?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const levelColors: Record<string, string> = {
  fatal: '#e5484d',
  error: '#e5933a',
  warning: '#f5d90a',
  info: '#3b82f6',
  debug: '#6e6f78',
};

const breadcrumbLevelColors: Record<string, string> = {
  fatal: '#e5484d',
  error: '#e5484d',
  warning: '#e5933a',
  info: '#3b82f6',
  debug: '#6e6f78',
};

const breadcrumbCategoryIcons: Record<string, string> = {
  'navigation': '🧭',
  'http': '🌐',
  'ui.click': '👆',
  'ui.input': '⌨️',
  'console': '💬',
  'fetch': '🌐',
  'xhr': '🌐',
  'sentry.transaction': '⚡',
  'sentry.event': '📋',
};

const STATUS_OPTIONS = [
  { value: 'unresolved', label: 'Unresolved', color: '#e5933a' },
  { value: 'resolved', label: 'Resolved', color: '#46a758' },
  { value: 'ignored', label: 'Ignored', color: '#6e6f78' },
];

function ColorDot({ color }: { color: string }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: color, display: 'inline-block', flexShrink: 0,
    }} />
  );
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function formatBreadcrumbTime(timestamp?: string): string {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function extractStackFrames(entries?: Array<{ type: string; data: any }>): Array<{
  filename: string;
  function: string;
  lineNo: number | null;
  colNo: number | null;
  context: Array<[number, string]>;
  inApp: boolean;
}> {
  if (!entries) return [];
  for (const entry of entries) {
    if (entry.type === 'exception' && entry.data?.values) {
      for (const ex of entry.data.values) {
        if (ex.stacktrace?.frames) {
          return ex.stacktrace.frames
            .filter((f: any) => f.inApp)
            .slice(-10)
            .reverse()
            .map((f: any) => ({
              filename: f.filename ?? f.absPath ?? '(unknown)',
              function: f.function ?? '(anonymous)',
              lineNo: f.lineNo,
              colNo: f.colNo,
              context: f.context ?? [],
              inApp: f.inApp ?? false,
            }));
        }
      }
    }
  }
  return [];
}

function extractBreadcrumbs(entries?: Array<{ type: string; data: any }>): Breadcrumb[] {
  if (!entries) return [];
  for (const entry of entries) {
    if (entry.type === 'breadcrumbs' && entry.data?.values) {
      return entry.data.values.slice(-25);
    }
  }
  return [];
}

function extractRequest(entries?: Array<{ type: string; data: any }>): {
  method?: string;
  url?: string;
  headers?: Array<[string, string]>;
  query?: string;
  data?: any;
} | null {
  if (!entries) return null;
  for (const entry of entries) {
    if (entry.type === 'request' && entry.data) {
      return entry.data;
    }
  }
  return null;
}

function extractExceptions(entries?: Array<{ type: string; data: any }>): Array<{
  type: string;
  value: string;
  mechanism?: { type?: string; handled?: boolean; description?: string };
}> {
  if (!entries) return [];
  for (const entry of entries) {
    if (entry.type === 'exception' && entry.data?.values) {
      return entry.data.values.map((ex: any) => ({
        type: ex.type ?? 'Error',
        value: ex.value ?? '',
        mechanism: ex.mechanism,
      }));
    }
  }
  return [];
}

function buildEntityUri(issueId: string): string {
  return `@drift//sentry_issue/${issueId}`;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface IssueDrawerProps {
  entityId: string;
  entityType: string;
  pathSegments: string[];
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

// ── Sub-components ───────────────────────────────────────────────────────────

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
      <span style={{ width: 80, flexShrink: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function BreadcrumbsSection({ breadcrumbs }: { breadcrumbs: Breadcrumb[] }) {
  const [expanded, setExpanded] = useState(false);
  const displayCount = expanded ? breadcrumbs.length : 8;
  const visible = breadcrumbs.slice(-displayCount);

  return (
    <ContentSection title={`Breadcrumbs (${breadcrumbs.length})`}>
      <div style={{
        display: 'flex', flexDirection: 'column',
        borderRadius: '6px', overflow: 'hidden',
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        maxHeight: expanded ? '400px' : '260px',
        overflowY: 'auto',
      }}>
        {visible.map((crumb, i) => {
          const icon = breadcrumbCategoryIcons[crumb.category ?? ''] ?? '•';
          const color = breadcrumbLevelColors[crumb.level ?? 'info'] ?? 'var(--text-muted)';
          const isLast = i === visible.length - 1;

          return (
            <div
              key={i}
              style={{
                padding: '5px 10px',
                borderBottom: isLast ? 'none' : '1px solid var(--border-muted)',
                fontSize: '11px',
                background: isLast ? 'rgba(229,147,58,0.06)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10px', flexShrink: 0, width: '14px', textAlign: 'center' }}>{icon}</span>
                <span style={{
                  fontWeight: 500, color: 'var(--text-secondary)',
                  fontSize: '10px', flexShrink: 0, minWidth: '60px',
                }}>
                  {crumb.category ?? crumb.type ?? 'default'}
                </span>
                <span style={{
                  color: 'var(--text-primary)', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {crumb.message || (crumb.data?.url) || (crumb.data?.to) || '—'}
                </span>
                {crumb.level && crumb.level !== 'info' && (
                  <span style={{
                    fontSize: '9px', padding: '0 4px', borderRadius: '3px',
                    background: color + '22', color, fontWeight: 600,
                    textTransform: 'uppercase', flexShrink: 0,
                  }}>
                    {crumb.level}
                  </span>
                )}
                <span style={{ color: 'var(--text-muted)', fontSize: '10px', flexShrink: 0 }}>
                  {formatBreadcrumbTime(crumb.timestamp)}
                </span>
              </div>
              {crumb.data && (crumb.category === 'http' || crumb.category === 'fetch' || crumb.category === 'xhr') && (
                <div style={{ marginLeft: '20px', marginTop: '2px', color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'monospace' }}>
                  {crumb.data?.method && <span>{crumb.data.method} </span>}
                  {crumb.data?.status_code && (
                    <span style={{ color: crumb.data.status_code >= 400 ? '#e5484d' : '#46a758' }}>
                      {crumb.data.status_code}
                    </span>
                  )}
                  {crumb.data?.reason && <span> {crumb.data.reason}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {breadcrumbs.length > 8 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: 'none', border: 'none', padding: '4px 0', marginTop: '4px',
            color: '#6C5FC7', fontSize: '11px', cursor: 'pointer',
          }}
        >
          {expanded ? 'Show less' : `Show all ${breadcrumbs.length} breadcrumbs`}
        </button>
      )}
    </ContentSection>
  );
}

function RequestSection({ request }: { request: NonNullable<ReturnType<typeof extractRequest>> }) {
  const [showHeaders, setShowHeaders] = useState(false);

  const methodColor: Record<string, string> = {
    GET: '#3b82f6', POST: '#46a758', PUT: '#e5933a',
    PATCH: '#e5933a', DELETE: '#e5484d',
  };

  const headers = Array.isArray(request.headers)
    ? request.headers
    : Object.entries(request.headers ?? {});

  const safeHeaders = headers.filter(
    ([key]: [string, string]) => !['cookie', 'authorization', 'x-csrf-token'].includes(key.toLowerCase()),
  );

  return (
    <ContentSection title="HTTP Request">
      <div style={{
        borderRadius: '6px', overflow: 'hidden',
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
      }}>
        <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {request.method && (
            <span style={{
              fontSize: '11px', fontWeight: 700, padding: '1px 6px', borderRadius: '3px',
              background: (methodColor[request.method.toUpperCase()] ?? '#6e6f78') + '22',
              color: methodColor[request.method.toUpperCase()] ?? 'var(--text-secondary)',
            }}>
              {request.method.toUpperCase()}
            </span>
          )}
          <span style={{
            fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {request.url ?? '—'}
          </span>
        </div>
        {request.query && (
          <div style={{
            padding: '4px 10px', borderTop: '1px solid var(--border-muted)',
            fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)',
            wordBreak: 'break-all',
          }}>
            ?{request.query}
          </div>
        )}
        {safeHeaders.length > 0 && (
          <>
            <button
              onClick={() => setShowHeaders(!showHeaders)}
              style={{
                width: '100%', padding: '4px 10px',
                borderTop: '1px solid var(--border-muted)',
                background: 'none', border: 'none', borderBottom: 'none',
                fontSize: '10px', color: '#6C5FC7', cursor: 'pointer', textAlign: 'left',
              }}
            >
              {showHeaders ? 'Hide' : 'Show'} headers ({safeHeaders.length})
            </button>
            {showHeaders && (
              <div style={{ padding: '4px 10px', fontSize: '10px', fontFamily: 'monospace' }}>
                {safeHeaders.map(([key, value]: [string, string], i: number) => (
                  <div key={i} style={{ marginBottom: '1px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{key}: </span>
                    <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{value}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {request.data && (
          <div style={{
            padding: '6px 10px', borderTop: '1px solid var(--border-muted)',
            fontSize: '10px', fontFamily: 'monospace', color: 'var(--text-secondary)',
            maxHeight: '80px', overflow: 'auto', wordBreak: 'break-all',
          }}>
            {typeof request.data === 'string' ? request.data : JSON.stringify(request.data, null, 2)}
          </div>
        )}
      </div>
    </ContentSection>
  );
}

function EnvironmentSection({ contexts, event }: { contexts: Record<string, any>; event: SentryEvent }) {
  const items: Array<{ label: string; value: string }> = [];

  if (contexts.browser?.name) {
    items.push({ label: 'Browser', value: `${contexts.browser.name}${contexts.browser.version ? ` ${contexts.browser.version}` : ''}` });
  }
  if (contexts.os?.name) {
    items.push({ label: 'OS', value: `${contexts.os.name}${contexts.os.version ? ` ${contexts.os.version}` : ''}` });
  }
  if (contexts.device?.model) {
    items.push({ label: 'Device', value: `${contexts.device.brand ? `${contexts.device.brand} ` : ''}${contexts.device.model}` });
  }
  if (contexts.runtime?.name) {
    items.push({ label: 'Runtime', value: `${contexts.runtime.name}${contexts.runtime.version ? ` ${contexts.runtime.version}` : ''}` });
  }
  if (event.environment) {
    items.push({ label: 'Environment', value: event.environment });
  }
  if (event.release?.version) {
    items.push({ label: 'Release', value: event.release.version });
  }
  if (contexts.trace?.trace_id) {
    items.push({ label: 'Trace', value: contexts.trace.trace_id.substring(0, 16) + '...' });
  }

  if (items.length === 0) return null;

  return (
    <ContentSection title="Environment">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {items.map((item) => (
          <span
            key={item.label}
            style={{
              fontSize: '11px', padding: '3px 8px', borderRadius: '4px',
              background: 'var(--surface-hover)', color: 'var(--text-secondary)',
              display: 'inline-flex', alignItems: 'center', gap: '4px',
            }}
          >
            <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: '10px' }}>{item.label}</span>
            {item.value}
          </span>
        ))}
      </div>
    </ContentSection>
  );
}

function UserSection({ user }: { user: NonNullable<SentryEvent['user']> }) {
  const parts: string[] = [];
  if (user.email) parts.push(user.email);
  else if (user.username) parts.push(user.username);
  else if (user.id) parts.push(`ID: ${user.id}`);
  if (user.ipAddress) parts.push(user.ipAddress);

  if (parts.length === 0) return null;

  return (
    <ContentSection title="Affected User">
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '6px 10px', borderRadius: '6px',
        border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)',
        fontSize: '12px',
      }}>
        <span style={{
          width: '24px', height: '24px', borderRadius: '50%',
          background: '#6C5FC7', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11px', fontWeight: 600, flexShrink: 0,
        }}>
          {(user.email ?? user.username ?? user.id ?? '?')[0].toUpperCase()}
        </span>
        <div>
          <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {user.email ?? user.username ?? `User ${user.id}`}
          </div>
          {user.ipAddress && user.email && (
            <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{user.ipAddress}</div>
          )}
        </div>
      </div>
    </ContentSection>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function IssueDrawer({ entityId, pathSegments, label, drawer }: IssueDrawerProps) {
  const issueId = entityId || pathSegments?.[0];
  const [expandedFrame, setExpandedFrame] = useState<number | null>(0);

  // ── Workstream linking ──────────────────────────────────────────────────
  const entityUri = buildEntityUri(issueId);
  const workstreamLinker = useWorkstreamLinker(entityUri, 'sentry_issue');

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data: issueData, loading: issueLoading, refetch: refetchIssue } = useEntityQuery(GET_ISSUE, {
    variables: { id: issueId },
    skip: !issueId,
  });

  const { data: eventsData } = useEntityQuery(GET_EVENTS, {
    variables: { issueId, limit: 5 },
    skip: !issueId,
  });

  const { data: latestData } = useEntityQuery(GET_LATEST_EVENT, {
    variables: { issueId },
    skip: !issueId,
  });

  const { data: membersData } = useEntityQuery(GET_MEMBERS);

  // ── Mutations ───────────────────────────────────────────────────────────
  const [resolveIssue] = useEntityMutation(RESOLVE_ISSUE);
  const [unresolveIssue] = useEntityMutation(UNRESOLVE_ISSUE);
  const [ignoreIssue] = useEntityMutation(IGNORE_ISSUE);
  const [assignIssue] = useEntityMutation(ASSIGN_ISSUE);
  const [unassignIssue] = useEntityMutation(UNASSIGN_ISSUE);

  // ── Derived data ────────────────────────────────────────────────────────
  const issue: SentryIssue | undefined = issueData?.sentryIssue;
  const events: SentryEvent[] = eventsData?.sentryIssueEvents ?? [];
  const latestEvent: SentryEvent | undefined = latestData?.sentryLatestEvent;
  const members: SentryMember[] = membersData?.sentryMembers ?? [];

  const stackFrames = extractStackFrames(latestEvent?.entries);
  const breadcrumbs = extractBreadcrumbs(latestEvent?.entries);
  const requestInfo = extractRequest(latestEvent?.entries);
  const exceptions = extractExceptions(latestEvent?.entries);
  const contexts = latestEvent?.contexts ?? {};

  // ── Loading / Error ─────────────────────────────────────────────────────
  if (issueLoading && !issue) {
    return (
      <>
        <DrawerHeaderTitle>{label ?? issueId}</DrawerHeaderTitle>
        <DrawerBody>
          <div style={{ padding: '16px', color: 'var(--text-muted)' }}>Loading issue details...</div>
        </DrawerBody>
      </>
    );
  }

  if (!issue) {
    return (
      <>
        <DrawerHeaderTitle>{label ?? 'Issue Not Found'}</DrawerHeaderTitle>
        <DrawerBody>
          <div style={{ padding: '16px', color: 'var(--text-muted)' }}>Could not load issue {issueId}</div>
        </DrawerBody>
      </>
    );
  }

  const levelColor = levelColors[issue.level] ?? 'var(--text-muted)';

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleStatusChange = async (newStatus: string) => {
    try {
      if (newStatus === 'resolved') {
        await resolveIssue({ variables: { id: issue.id } });
      } else if (newStatus === 'ignored') {
        await ignoreIssue({ variables: { id: issue.id } });
      } else {
        await unresolveIssue({ variables: { id: issue.id } });
      }
      refetchIssue();
    } catch (err: any) {
      logger.error('Failed to update issue status', { error: err?.message });
    }
  };

  const handleAssigneeChange = async (value: string) => {
    try {
      if (value === '__unassigned__') {
        await unassignIssue({ variables: { id: issue.id } });
      } else {
        await assignIssue({ variables: { id: issue.id, assignedTo: `user:${value}` } });
      }
      refetchIssue();
    } catch (err: any) {
      logger.error('Failed to update assignee', { error: err?.message });
    }
  };

  const handleOpenInSentry = () => {
    if (issue.permalink) {
      openExternal(issue.permalink);
      logger.info('Opened issue in Sentry', { shortId: issue.shortId });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Header: identifier + title */}
      <DrawerHeaderTitle>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ flexShrink: 0, color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>
            {issue.shortId}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1, fontSize: 14 }}>
            {issue.title}
          </span>
        </span>
      </DrawerHeaderTitle>

      <DrawerHeaderActions>
        {workstreamLinker.activeWorkstreams && (
          <WorkstreamHeaderAction
            entityId={issue.id}
            entityTitle={`${issue.shortId} ${issue.title}`}
            linkedWorkstreams={workstreamLinker.linkedWorkstreams}
            activeWorkstreams={workstreamLinker.activeWorkstreams}
            onStartWorkstream={(_id: string, title: string) => workstreamLinker.startWorkstream(title)}
            onAddToWorkstream={workstreamLinker.linkWorkstream}
          />
        )}
      </DrawerHeaderActions>

      <DrawerBody>

      {/* Level badge + culprit */}
      <ContentSection>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
            background: levelColor, color: '#fff', textTransform: 'uppercase', flexShrink: 0,
          }}>
            {issue.level}
          </span>
          {issue.culprit && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {issue.culprit}
            </span>
          )}
        </div>
      </ContentSection>

      <Separator />

      {/* Editable properties */}
      <ContentSection title="Properties">
        <PropertyRow label="Status">
          <Select
            value={issue.status}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger size="sm" className="h-7 w-full text-xs">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ColorDot color={opt.color} />
                    {opt.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropertyRow>

        <PropertyRow label="Assignee">
          <Combobox
            options={[
              { value: '__unassigned__', label: 'Unassigned' },
              ...members.map((m) => ({
                value: m.id,
                label: m.name + (m.email ? ` (${m.email})` : ''),
              })),
            ]}
            value={issue.assignedTo?.id ?? '__unassigned__'}
            onValueChange={handleAssigneeChange}
            placeholder="Unassigned"
            searchPlaceholder="Search members..."
            className="min-h-7 text-xs"
          />
        </PropertyRow>

        <PropertyRow label="Project">
          <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{issue.project.name}</span>
        </PropertyRow>

        <PropertyRow label="Events">
          <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{issue.count}</span>
        </PropertyRow>

        <PropertyRow label="Users">
          <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{issue.userCount}</span>
        </PropertyRow>

        <PropertyRow label="First seen">
          <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{formatTimeAgo(issue.firstSeen)}</span>
        </PropertyRow>

        <PropertyRow label="Last seen">
          <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{formatTimeAgo(issue.lastSeen)}</span>
        </PropertyRow>

        {issue.platform && (
          <PropertyRow label="Platform">
            <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{issue.platform}</span>
          </PropertyRow>
        )}
      </ContentSection>

      <Separator />

      {/* Workstreams */}
      {workstreamLinker.activeWorkstreams && entityUri && (
        <>
          <WorkstreamSection
            workstreams={workstreamLinker.linkedWorkstreams ?? []}
            entityId={issue.id}
            entityTitle={`${issue.shortId} ${issue.title}`}
            activeWorkstreams={workstreamLinker.activeWorkstreams}
            onRemove={workstreamLinker.unlinkWorkstream}
            onClick={(ws: LinkedWorkstream) => { workstreamLinker.navigateToWorkstream(ws); drawer.close(); }}
            onStartWorkstream={(_id: string, title: string) => workstreamLinker.startWorkstream(title)}
            onAddToWorkstream={workstreamLinker.linkWorkstream}
          />
          <Separator />
        </>
      )}

      {/* Exception Details */}
      {exceptions.length > 0 && (
        <>
          <ContentSection title={exceptions.length > 1 ? `Exceptions (${exceptions.length})` : 'Exception'}>
            {exceptions.map((ex, i) => (
              <div key={i} style={{ marginBottom: i < exceptions.length - 1 ? '8px' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                    {ex.type}
                  </span>
                  {ex.mechanism && (
                    <span style={{
                      fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                      background: ex.mechanism.handled === false ? 'rgba(229,72,77,0.15)' : 'var(--surface-hover)',
                      color: ex.mechanism.handled === false ? '#e5484d' : 'var(--text-muted)',
                      fontWeight: 600,
                    }}>
                      {ex.mechanism.handled === false ? 'unhandled' : 'handled'}
                    </span>
                  )}
                </div>
                {ex.value && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px', wordBreak: 'break-word' }}>
                    {ex.value}
                  </div>
                )}
                {ex.mechanism?.type && ex.mechanism.type !== 'generic' && (
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    via {ex.mechanism.type}{ex.mechanism.description ? `: ${ex.mechanism.description}` : ''}
                  </div>
                )}
              </div>
            ))}
          </ContentSection>
          <Separator />
        </>
      )}

      {/* Fallback to metadata-based error if no exception entries */}
      {exceptions.length === 0 && issue.metadata && (issue.metadata.type || issue.metadata.value) && (
        <>
          <ContentSection title="Error">
            {issue.metadata.type && (
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                {issue.metadata.type}
              </div>
            )}
            {issue.metadata.value && (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', wordBreak: 'break-word' }}>
                {issue.metadata.value}
              </div>
            )}
            {issue.metadata.filename && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'monospace' }}>
                {issue.metadata.filename}{issue.metadata.function ? ` in ${issue.metadata.function}` : ''}
              </div>
            )}
          </ContentSection>
          <Separator />
        </>
      )}

      {/* Stack Trace */}
      {stackFrames.length > 0 && (
        <>
          <ContentSection title="Stack Trace (in-app)">
            <div style={{
              borderRadius: '6px', overflow: 'hidden',
              border: '1px solid var(--border-muted)',
              background: 'var(--surface-code, var(--surface-subtle))',
              fontSize: '11px', fontFamily: 'monospace',
            }}>
              {stackFrames.map((frame, i) => {
                const hasContext = frame.context && frame.context.length > 0;
                const isExpanded = expandedFrame === i;

                return (
                  <div key={i}>
                    <div
                      style={{
                        padding: '5px 10px',
                        borderBottom: (i < stackFrames.length - 1 || isExpanded) ? '1px solid var(--border-muted)' : 'none',
                        display: 'flex', gap: '8px', alignItems: 'center',
                        color: i === 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontWeight: i === 0 ? 500 : 400,
                        cursor: hasContext ? 'pointer' : 'default',
                        background: isExpanded ? 'rgba(108,95,199,0.05)' : 'transparent',
                      }}
                      onClick={() => hasContext && setExpandedFrame(isExpanded ? null : i)}
                    >
                      {hasContext && (
                        <span style={{ fontSize: '9px', color: '#6C5FC7', flexShrink: 0 }}>
                          {isExpanded ? '▼' : '▶'}
                        </span>
                      )}
                      <span style={{ color: '#6C5FC7', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {frame.function}
                      </span>
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: 'auto' }}>
                        {frame.filename}{frame.lineNo != null ? `:${frame.lineNo}` : ''}{frame.colNo != null ? `:${frame.colNo}` : ''}
                      </span>
                    </div>
                    {isExpanded && hasContext && (
                      <div style={{
                        background: 'var(--surface-code, rgba(0,0,0,0.03))',
                        borderBottom: i < stackFrames.length - 1 ? '1px solid var(--border-muted)' : 'none',
                        padding: '4px 0',
                        overflow: 'auto',
                      }}>
                        {frame.context.map(([lineNum, code]: [number, string]) => {
                          const isCurrentLine = lineNum === frame.lineNo;
                          return (
                            <div
                              key={lineNum}
                              style={{
                                display: 'flex', padding: '0 10px',
                                background: isCurrentLine ? 'rgba(229,147,58,0.1)' : 'transparent',
                                borderLeft: isCurrentLine ? '2px solid #e5933a' : '2px solid transparent',
                              }}
                            >
                              <span style={{
                                color: 'var(--text-muted)', userSelect: 'none',
                                minWidth: '36px', textAlign: 'right', paddingRight: '12px',
                                fontSize: '10px',
                              }}>
                                {lineNum}
                              </span>
                              <span style={{
                                color: isCurrentLine ? 'var(--text-primary)' : 'var(--text-secondary)',
                                whiteSpace: 'pre',
                              }}>
                                {code}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ContentSection>
          <Separator />
        </>
      )}

      {/* HTTP Request */}
      {requestInfo && (requestInfo.url || requestInfo.method) && (
        <>
          <RequestSection request={requestInfo} />
          <Separator />
        </>
      )}

      {/* Environment & Context */}
      {(Object.keys(contexts).length > 0 || latestEvent?.environment || latestEvent?.release) && (
        <>
          <EnvironmentSection contexts={contexts} event={latestEvent!} />
          <Separator />
        </>
      )}

      {/* Affected User */}
      {latestEvent?.user && (latestEvent.user.email || latestEvent.user.username || latestEvent.user.id) && (
        <>
          <UserSection user={latestEvent.user} />
          <Separator />
        </>
      )}

      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <>
          <BreadcrumbsSection breadcrumbs={breadcrumbs} />
          <Separator />
        </>
      )}

      {/* Tags */}
      {latestEvent?.tags && latestEvent.tags.length > 0 && (
        <>
          <ContentSection title="Tags">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {latestEvent.tags.slice(0, 20).map((tag) => (
                <span
                  key={tag.key}
                  style={{
                    fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
                    background: 'var(--surface-hover)', color: 'var(--text-secondary)',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{tag.key}:</span> {tag.value}
                </span>
              ))}
            </div>
          </ContentSection>
          <Separator />
        </>
      )}

      {/* Recent Events */}
      {events.length > 0 && (
        <ContentSection title={`Recent Events (${events.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {events.map((event) => (
              <div
                key={event.eventID}
                style={{
                  padding: '6px 10px', borderRadius: '4px',
                  background: 'var(--surface-subtle)',
                  border: '1px solid var(--border-muted)',
                  fontSize: '11px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                    {event.title}
                  </span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: '8px' }}>
                    {formatTimeAgo(event.dateCreated)}
                  </span>
                </div>
                {(event.environment || event.user?.email) && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '2px', fontSize: '10px', color: 'var(--text-muted)' }}>
                    {event.environment && <span>{event.environment}</span>}
                    {event.user?.email && <span>{event.user.email}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ContentSection>
      )}

      {/* Sticky Footer CTA — Open in Sentry */}
      {issue.permalink && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 8,
            borderTop: '1px solid var(--border-muted)',
            background: 'var(--surface-page)',
          }}
        >
          <a
            href={issue.permalink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              handleOpenInSentry();
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--text-muted)',
              textDecoration: 'none',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#6C5FC7';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            {/* Sentry logo mark */}
            <svg width="14" height="14" viewBox="0 0 72 66" fill="currentColor">
              <path d="M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07A35.88,35.88,0,0,0,16.41,8.8l4.67-8.14a.71.71,0,0,1,1.24,0l36.18,63a.71.71,0,0,1-.62,1.07H41.08a.71.71,0,0,1-.62-.36l-2.93-5a10.75,10.75,0,0,0-3.36,1.9l3,5.09a4.53,4.53,0,0,0,3.91,2.26H57.88A4.53,4.53,0,0,0,61.79,62.5Z"/>
            </svg>
            Open in Sentry
          </a>
        </div>
      )}

      </DrawerBody>
    </>
  );
}
