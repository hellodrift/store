import { useState } from 'react';
import { DrawerHeaderTitle, DrawerBody, ContentSection, Button, Separator, Badge } from '@drift/ui';
import { useEntityQuery, useEntityMutation, gql, logger } from '@drift/plugin-api';

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
  user?: { id?: string; email?: string; username?: string; ipAddress?: string } | null;
  release?: { version: string } | null;
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

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
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

/**
 * Extract stack frames from event entries.
 */
function extractStackFrames(entries?: Array<{ type: string; data: any }>): Array<{
  filename: string;
  function: string;
  lineNo: number | null;
  inApp: boolean;
}> {
  if (!entries) return [];
  for (const entry of entries) {
    if (entry.type === 'exception' && entry.data?.values) {
      for (const ex of entry.data.values) {
        if (ex.stacktrace?.frames) {
          return ex.stacktrace.frames
            .filter((f: any) => f.inApp)
            .slice(-8)
            .reverse()
            .map((f: any) => ({
              filename: f.filename ?? f.absPath ?? '(unknown)',
              function: f.function ?? '(anonymous)',
              lineNo: f.lineNo,
              inApp: f.inApp ?? false,
            }));
        }
      }
    }
  }
  return [];
}

// ── Props ────────────────────────────────────────────────────────────────────

interface IssueDrawerProps {
  payload: { entityUri: string; pathSegments: string[] };
  drawer: {
    close: () => void;
    open: (payload: Record<string, unknown>) => void;
    push: (payload: Record<string, unknown>) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function IssueDrawer({ payload }: IssueDrawerProps) {
  const issueId = payload.pathSegments?.[0];
  const [showAssign, setShowAssign] = useState(false);

  // Queries
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

  const { data: membersData } = useEntityQuery(GET_MEMBERS, {
    skip: !showAssign,
  });

  // Mutations
  const [resolveIssue] = useEntityMutation(RESOLVE_ISSUE);
  const [unresolveIssue] = useEntityMutation(UNRESOLVE_ISSUE);
  const [ignoreIssue] = useEntityMutation(IGNORE_ISSUE);
  const [assignIssue] = useEntityMutation(ASSIGN_ISSUE);
  const [unassignIssue] = useEntityMutation(UNASSIGN_ISSUE);

  const issue: SentryIssue | undefined = issueData?.sentryIssue;
  const events: SentryEvent[] = eventsData?.sentryIssueEvents ?? [];
  const latestEvent: SentryEvent | undefined = latestData?.sentryLatestEvent;
  const members: SentryMember[] = membersData?.sentryMembers ?? [];

  if (issueLoading && !issue) {
    return (
      <>
        <DrawerHeaderTitle>Loading...</DrawerHeaderTitle>
        <DrawerBody>
          <div style={{ padding: '16px', color: 'var(--text-muted)' }}>Loading issue details...</div>
        </DrawerBody>
      </>
    );
  }

  if (!issue) {
    return (
      <>
        <DrawerHeaderTitle>Issue Not Found</DrawerHeaderTitle>
        <DrawerBody>
          <div style={{ padding: '16px', color: 'var(--text-muted)' }}>Could not load issue {issueId}</div>
        </DrawerBody>
      </>
    );
  }

  const levelColor = levelColors[issue.level] ?? 'var(--text-muted)';
  const stackFrames = extractStackFrames(latestEvent?.entries);

  const handleResolve = async () => {
    try {
      if (issue.status === 'resolved') {
        await unresolveIssue({ variables: { id: issue.id } });
      } else {
        await resolveIssue({ variables: { id: issue.id } });
      }
      refetchIssue();
    } catch (err: any) {
      logger.error('Failed to update issue status', { error: err?.message });
    }
  };

  const handleIgnore = async () => {
    try {
      await ignoreIssue({ variables: { id: issue.id } });
      refetchIssue();
    } catch (err: any) {
      logger.error('Failed to ignore issue', { error: err?.message });
    }
  };

  const handleAssign = async (memberId: string) => {
    try {
      await assignIssue({ variables: { id: issue.id, assignedTo: `user:${memberId}` } });
      setShowAssign(false);
      refetchIssue();
    } catch (err: any) {
      logger.error('Failed to assign issue', { error: err?.message });
    }
  };

  const handleUnassign = async () => {
    try {
      await unassignIssue({ variables: { id: issue.id } });
      refetchIssue();
    } catch (err: any) {
      logger.error('Failed to unassign issue', { error: err?.message });
    }
  };

  return (
    <>
      <DrawerHeaderTitle>{issue.shortId}</DrawerHeaderTitle>

      <DrawerBody>

      {/* Header: Level + Title */}
      <ContentSection>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <span style={{
            padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
            background: levelColor, color: '#fff', textTransform: 'uppercase', flexShrink: 0,
          }}>
            {issue.level}
          </span>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
              {issue.title}
            </div>
            {issue.culprit && (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', fontFamily: 'monospace' }}>
                {issue.culprit}
              </div>
            )}
          </div>
        </div>
      </ContentSection>

      <Separator />

      {/* Metadata */}
      <ContentSection title="Details">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Project</span>
            <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{issue.project.name}</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Status</span>
            <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              {issue.status}{issue.substatus ? ` (${issue.substatus})` : ''}
            </div>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Events</span>
            <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{issue.count}</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Users</span>
            <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{issue.userCount}</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>First Seen</span>
            <div style={{ color: 'var(--text-primary)' }}>{formatTimeAgo(issue.firstSeen)}</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Last Seen</span>
            <div style={{ color: 'var(--text-primary)' }}>{formatTimeAgo(issue.lastSeen)}</div>
          </div>
          {issue.platform && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Platform</span>
              <div style={{ color: 'var(--text-primary)' }}>{issue.platform}</div>
            </div>
          )}
          {issue.assignedTo && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Assigned To</span>
              <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{issue.assignedTo.name}</div>
            </div>
          )}
        </div>
      </ContentSection>

      {/* Error Details */}
      {issue.metadata && (issue.metadata.type || issue.metadata.value) && (
        <>
          <Separator />
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
        </>
      )}

      {/* Stack Trace */}
      {stackFrames.length > 0 && (
        <>
          <Separator />
          <ContentSection title="Stack Trace (in-app)">
            <div style={{
              borderRadius: '6px', overflow: 'hidden',
              border: '1px solid var(--border-muted)',
              background: 'var(--surface-code, var(--surface-subtle))',
              fontSize: '11px', fontFamily: 'monospace',
            }}>
              {stackFrames.map((frame, i) => (
                <div
                  key={i}
                  style={{
                    padding: '4px 10px',
                    borderBottom: i < stackFrames.length - 1 ? '1px solid var(--border-muted)' : 'none',
                    display: 'flex', gap: '8px',
                    color: i === 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: i === 0 ? 500 : 400,
                  }}
                >
                  <span style={{ color: '#6C5FC7', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {frame.function}
                  </span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                    {frame.filename}{frame.lineNo != null ? `:${frame.lineNo}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </ContentSection>
        </>
      )}

      {/* Tags from Latest Event */}
      {latestEvent?.tags && latestEvent.tags.length > 0 && (
        <>
          <Separator />
          <ContentSection title="Tags">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {latestEvent.tags.slice(0, 15).map((tag) => (
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
        </>
      )}

      {/* Recent Events */}
      {events.length > 0 && (
        <>
          <Separator />
          <ContentSection title={`Recent Events (${events.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {events.map((event) => (
                <div
                  key={event.eventID}
                  style={{
                    padding: '6px 10px', borderRadius: '4px',
                    background: 'var(--surface-subtle)',
                    border: '1px solid var(--border-muted)',
                    fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                    {event.title}
                  </span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: '8px' }}>
                    {formatTimeAgo(event.dateCreated)}
                  </span>
                </div>
              ))}
            </div>
          </ContentSection>
        </>
      )}

      {/* Assign Dropdown */}
      {showAssign && (
        <>
          <Separator />
          <ContentSection title="Assign To">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '200px', overflow: 'auto' }}>
              {issue.assignedTo && (
                <Button variant="ghost" size="sm" onClick={handleUnassign} style={{ justifyContent: 'flex-start', color: '#e5484d' }}>
                  Unassign {issue.assignedTo.name}
                </Button>
              )}
              {members.map((member) => (
                <Button
                  key={member.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAssign(member.id)}
                  style={{ justifyContent: 'flex-start' }}
                >
                  {member.name}{member.email ? ` (${member.email})` : ''}
                </Button>
              ))}
              {members.length === 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px' }}>Loading members...</div>
              )}
            </div>
          </ContentSection>
        </>
      )}

      <Separator />

      {/* Actions */}
      <ContentSection>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <Button
            variant={issue.status === 'resolved' ? 'outline' : 'default'}
            size="sm"
            onClick={handleResolve}
          >
            {issue.status === 'resolved' ? 'Unresolve' : 'Resolve'}
          </Button>
          {issue.status !== 'ignored' && (
            <Button variant="outline" size="sm" onClick={handleIgnore}>
              Ignore
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAssign(!showAssign)}
          >
            {issue.assignedTo ? `Assigned: ${issue.assignedTo.name}` : 'Assign'}
          </Button>
        </div>
      </ContentSection>

      {/* Footer */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border-muted)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: '12px',
      }}>
        <span style={{ color: 'var(--text-muted)' }}>{issue.shortId}</span>
        {issue.permalink && (
          <a
            href={issue.permalink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#6C5FC7', textDecoration: 'none', fontWeight: 500 }}
          >
            Open in Sentry →
          </a>
        )}
      </div>

      </DrawerBody>
    </>
  );
}
