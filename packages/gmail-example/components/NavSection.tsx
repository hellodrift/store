import { NavSection, NavItem, NavSettingsButton, NavHeaderActions } from '@drift/ui/components';
import { useEntityQuery, gql, logger, useEntityDrawer, useEntitySelection, buildEntityURI } from '@drift/plugin-api';
import { useGmailSettings } from './useGmailSettings';

const GET_GMAIL_MESSAGES = gql`
  query GetGmailMessages($labelId: String, $maxResults: Int) {
    gmailMessages(labelId: $labelId, maxResults: $maxResults) {
      id
      title
      threadId
      snippet
      from
      to
      date
      labelIds
      labelNames
      isUnread
      isStarred
      isInbox
    }
  }
`;

interface GmailMsg {
  id: string;
  title: string;
  threadId: string;
  snippet?: string;
  from?: string;
  to?: string;
  date?: string;
  labelIds?: string[];
  labelNames?: string;
  isUnread?: boolean;
  isStarred?: boolean;
  isInbox?: boolean;
}

function extractSenderName(from?: string): string {
  if (!from) return '';
  // "John Doe <john@example.com>" → "John Doe"
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  // "john@example.com" → "john"
  const emailMatch = from.match(/^([^@]+)@/);
  return emailMatch ? emailMatch[1] : from.slice(0, 20);
}

function formatRelativeDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function getDateGroup(dateStr?: string): string {
  if (!dateStr) return 'Older';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const weekAgo = new Date(today.getTime() - 7 * 86_400_000);

    if (date >= today) return 'Today';
    if (date >= yesterday) return 'Yesterday';
    if (date >= weekAgo) return 'This Week';
    return 'Older';
  } catch {
    return 'Older';
  }
}

function groupMessages(messages: GmailMsg[], groupBy: string): Map<string, GmailMsg[]> {
  const groups = new Map<string, GmailMsg[]>();
  for (const msg of messages) {
    let key: string;
    switch (groupBy) {
      case 'date':
        key = getDateGroup(msg.date);
        break;
      case 'sender':
        key = extractSenderName(msg.from) || 'Unknown';
        break;
      case 'label':
        key = msg.labelIds?.[0] || 'No Label';
        break;
      default:
        key = '';
    }
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(msg);
  }
  return groups;
}

function MessageNavItem({ msg, onSelect }: { msg: GmailMsg; onSelect: () => void }) {
  const sender = extractSenderName(msg.from);
  const relDate = formatRelativeDate(msg.date);

  return (
    <NavItem
      key={msg.id}
      item={{
        id: msg.id,
        label: msg.title || '(No subject)',
        variant: 'item' as const,
        meta: (
          <span style={{
            fontSize: '10px',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            {msg.isStarred && (
              <span style={{ color: '#F4B400', fontSize: '10px' }}>&#9733;</span>
            )}
            {msg.isUnread && (
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--text-accent, #4285F4)',
                display: 'inline-block',
                flexShrink: 0,
              }} />
            )}
            <span style={{ fontWeight: msg.isUnread ? 600 : 400 }}>{sender}</span>
            {relDate && <span>{relDate}</span>}
          </span>
        ),
      }}
      onSelect={onSelect}
    />
  );
}

export default function GmailNav() {
  const [settings] = useGmailSettings();
  const { select } = useEntitySelection();
  const { data, loading, error } = useEntityQuery(GET_GMAIL_MESSAGES, {
    variables: {
      labelId: settings.labelId,
      maxResults: settings.maxResults,
    },
    pollInterval: settings.refreshInterval,
  });
  const { openEntityDrawer } = useEntityDrawer();

  let messages: GmailMsg[] = data?.gmailMessages ?? [];

  // Apply read filter client-side
  if (settings.readFilter === 'unread') {
    messages = messages.filter((m) => m.isUnread);
  } else if (settings.readFilter === 'read') {
    messages = messages.filter((m) => !m.isUnread);
  }

  const section = {
    id: 'gmail-messages',
    label: `Gmail${messages.length ? ` (${messages.length})` : ''}`,
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="20" height="16" x="2" y="4" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    ),
    items: [],
    isLoading: loading && !data,
    emptyState: error && !data ? error.message : 'No messages found',
    hoverActions: (
      <NavHeaderActions>
        <NavSettingsButton
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            select({ id: 'settings', type: 'drawer', data: {} });
          }}
          ariaLabel="Gmail settings"
        />
      </NavHeaderActions>
    ),
  };

  if (error && !data) {
    logger.error('Failed to load Gmail messages', { error: error.message });
  }

  const handleMessageSelect = (msg: GmailMsg) => {
    logger.info('Gmail message selected', { messageId: msg.id });
    openEntityDrawer(buildEntityURI('gmail_message', msg.id, msg.title));
  };

  // Render with grouping
  if (settings.groupBy !== 'none' && messages.length > 0) {
    const groups = groupMessages(messages, settings.groupBy);

    return (
      <NavSection section={section}>
        {Array.from(groups.entries()).map(([groupName, groupMessages]) => (
          <div key={groupName}>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '8px 12px 2px',
              }}
            >
              {groupName}
            </div>
            {groupMessages.map((msg) => (
              <MessageNavItem
                key={msg.id}
                msg={msg}
                onSelect={() => handleMessageSelect(msg)}
              />
            ))}
          </div>
        ))}
      </NavSection>
    );
  }

  return (
    <NavSection section={section}>
      {messages.map((msg) => (
        <MessageNavItem
          key={msg.id}
          msg={msg}
          onSelect={() => handleMessageSelect(msg)}
        />
      ))}
    </NavSection>
  );
}
