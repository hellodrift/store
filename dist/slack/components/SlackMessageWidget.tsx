import { useEntityQuery, gql, logger } from '@drift/plugin-api';

const GET_SLACK_MESSAGE = gql`
  query GetSlackMessage($channelId: ID!, $ts: String!) {
    slackMessage(channelId: $channelId, ts: $ts) {
      id
      text
      userId
      userName
      channelId
      channelName
      ts
      replyCount
      reactions { name count }
      timestamp
    }
  }
`;

interface SlackMessage {
  id: string;
  text: string;
  userId: string;
  userName?: string;
  channelId: string;
  channelName?: string;
  ts: string;
  replyCount?: number;
  reactions?: { name: string; count: number }[];
  timestamp?: string;
}

interface WidgetProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  compact: boolean;
  messageId: string;
}

function SlackMessageChip({
  message,
  loading,
  label,
}: {
  message?: SlackMessage;
  loading: boolean;
  label?: string;
}) {
  if (loading) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '1px 6px', borderRadius: '4px', fontSize: '12px',
        background: 'var(--surface-subtle)', color: 'var(--text-muted)',
      }}>
        Loading...
      </span>
    );
  }

  if (!message) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '1px 6px', borderRadius: '4px', fontSize: '12px',
        background: 'var(--surface-subtle)', color: 'var(--text-muted)',
      }}>
        {label || 'Unknown message'}
      </span>
    );
  }

  const preview = message.text.length > 50
    ? message.text.slice(0, 50) + '...'
    : message.text;

  const channel = message.channelName ? `#${message.channelName}` : '';
  const author = message.userName ? `@${message.userName}` : '';
  const parts = [channel, author, preview].filter(Boolean);

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '1px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 500,
      background: '#4A154B', color: '#fff',
      maxWidth: '350px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {parts.join(' \u00B7 ')}
    </span>
  );
}

function SlackMessageCard({
  message,
  loading,
  error,
}: {
  message?: SlackMessage;
  loading: boolean;
  error?: { message: string };
}) {
  if (loading) {
    return (
      <div style={{
        padding: '12px 16px', borderRadius: '8px',
        border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)',
      }}>
        <div style={{ height: '14px', width: '80px', borderRadius: '4px', background: 'var(--surface-hover)', marginBottom: '8px' }} />
        <div style={{ height: '12px', width: '200px', borderRadius: '4px', background: 'var(--surface-hover)' }} />
      </div>
    );
  }

  if (error || !message) {
    return (
      <div style={{
        padding: '12px 16px', borderRadius: '8px',
        border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)',
        color: 'var(--text-muted)', fontSize: '12px',
      }}>
        {error ? `Failed to load message: ${error.message}` : 'Message not found'}
      </div>
    );
  }

  return (
    <div style={{
      padding: '12px 16px', borderRadius: '8px',
      borderTop: '1px solid var(--border-muted)',
      borderRight: '1px solid var(--border-muted)',
      borderBottom: '1px solid var(--border-muted)',
      borderLeft: '3px solid #4A154B',
      background: 'var(--surface-subtle)',
    }}>
      {/* Header: Channel + Time */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#4A154B' }}>
          {message.channelName ? `#${message.channelName}` : message.channelId}
        </span>
        {message.timestamp && (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {new Date(message.timestamp).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}
          </span>
        )}
      </div>

      {/* Author */}
      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 600 }}>
        {message.userName ?? message.userId}
      </div>

      {/* Text */}
      <div style={{
        fontSize: '13px', fontWeight: 400, color: 'var(--text-primary)',
        marginBottom: '8px', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {message.text}
      </div>

      {/* Metadata row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
        {(message.replyCount ?? 0) > 0 && (
          <span style={{ color: 'var(--text-accent, #1264a3)', fontWeight: 500 }}>
            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
          </span>
        )}
        {message.reactions?.map((r) => (
          <span key={r.name} style={{ fontSize: '10px' }}>
            :{r.name}: {r.count}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function SlackMessageWidget({
  uri,
  entityType,
  pathSegments,
  label,
  compact,
}: WidgetProps) {
  const channelId = pathSegments[0];
  const ts = pathSegments[1];

  const { data, loading, error } = useEntityQuery(GET_SLACK_MESSAGE, {
    variables: { channelId, ts },
    skip: !channelId || !ts,
  });

  const message = data?.slackMessage as SlackMessage | undefined;

  if (error) {
    logger.error('Failed to load slack message for widget', {
      channelId, ts, uri, error: error.message,
    });
  }

  if (compact) {
    return <SlackMessageChip message={message} loading={loading} label={label} />;
  }
  return <SlackMessageCard message={message} loading={loading} error={error} />;
}
