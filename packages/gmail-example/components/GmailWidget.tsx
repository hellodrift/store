import { useEntityQuery, gql, logger } from '@drift/plugin-api';

const GET_GMAIL_MESSAGE = gql`
  query GetGmailMessage($id: ID!) {
    gmailMessage(id: $id) {
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
      url
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
  url?: string;
}

interface WidgetProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  compact: boolean;
  messageId: string;
}

function extractSenderName(from?: string): string {
  if (!from) return '';
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return from;
}

function GmailChip({
  message,
  loading,
  label,
}: {
  message?: GmailMsg;
  loading: boolean;
  label?: string;
}) {
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

  if (!message) {
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
        {label || 'Unknown message'}
      </span>
    );
  }

  const sender = extractSenderName(message.from);
  const displayText = sender
    ? `${sender} \u2014 ${message.title}`
    : message.title;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '1px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: message.isUnread ? 600 : 500,
        background: '#EA4335',
        color: '#fff',
        maxWidth: '300px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {message.isStarred && <span style={{ fontSize: 10 }}>&#9733;</span>}
      {displayText}
    </span>
  );
}

function GmailCard({
  message,
  loading,
  error,
}: {
  message?: GmailMsg;
  loading: boolean;
  error?: { message: string };
}) {
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
        <div
          style={{
            height: '14px',
            width: '80px',
            borderRadius: '4px',
            background: 'var(--surface-hover)',
            marginBottom: '8px',
          }}
        />
        <div
          style={{
            height: '12px',
            width: '200px',
            borderRadius: '4px',
            background: 'var(--surface-hover)',
          }}
        />
      </div>
    );
  }

  if (error || !message) {
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
        {error ? `Failed to load message: ${error.message}` : 'Message not found'}
      </div>
    );
  }

  const sender = extractSenderName(message.from);
  const borderColor = message.isUnread
    ? 'var(--text-accent, #4285F4)'
    : 'var(--border-muted)';

  // Filter out system labels for display
  const systemLabels = ['INBOX', 'UNREAD', 'STARRED', 'DRAFT', 'SENT', 'TRASH', 'SPAM', 'IMPORTANT'];
  const displayLabels = (message.labelIds ?? []).filter((l) => !systemLabels.includes(l) && !l.startsWith('CATEGORY_'));

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        borderTop: '1px solid var(--border-muted)',
        borderRight: '1px solid var(--border-muted)',
        borderBottom: '1px solid var(--border-muted)',
        borderLeft: `3px solid ${borderColor}`,
        background: 'var(--surface-subtle)',
      }}
    >
      {/* Header: Sender + Date */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '6px',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#EA4335' }}>
          {message.isStarred && <span style={{ marginRight: 4, color: '#F4B400' }}>&#9733;</span>}
          {sender || message.from || 'Unknown'}
        </span>
        {message.date && (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {(() => {
              try {
                return new Date(message.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              } catch {
                return '';
              }
            })()}
          </span>
        )}
      </div>

      {/* Subject */}
      <div
        style={{
          fontSize: '13px',
          fontWeight: message.isUnread ? 600 : 500,
          color: 'var(--text-primary)',
          marginBottom: '4px',
          lineHeight: 1.3,
        }}
      >
        {message.title}
      </div>

      {/* Snippet */}
      {message.snippet && (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginBottom: '8px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {message.snippet}
        </div>
      )}

      {/* Footer: Labels + Link */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '11px',
          color: 'var(--text-muted)',
        }}
      >
        {displayLabels.length > 0 && (
          <div style={{ display: 'flex', gap: 4 }}>
            {displayLabels.slice(0, 3).map((label) => (
              <span
                key={label}
                style={{
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'var(--surface-hover)',
                  fontSize: 10,
                }}
              >
                {label}
              </span>
            ))}
          </div>
        )}
        {message.url && (
          <a
            href={message.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#EA4335',
              textDecoration: 'none',
              marginLeft: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            Open in Gmail
          </a>
        )}
      </div>
    </div>
  );
}

export default function GmailWidget({
  uri,
  entityType,
  pathSegments,
  label,
  compact,
}: WidgetProps) {
  const messageId = pathSegments[0];
  const { data, loading, error } = useEntityQuery(GET_GMAIL_MESSAGE, {
    variables: { id: messageId },
    skip: !messageId,
  });

  const message = data?.gmailMessage as GmailMsg | undefined;

  if (error) {
    logger.error('Failed to load gmail message for widget', {
      messageId,
      uri,
      error: error.message,
    });
  }

  if (compact) {
    return <GmailChip message={message} loading={loading} label={label} />;
  }
  return <GmailCard message={message} loading={loading} error={error} />;
}
