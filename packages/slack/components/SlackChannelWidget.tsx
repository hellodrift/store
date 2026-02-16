import { useEntityQuery, gql, logger } from '@drift/plugin-api';

const GET_SLACK_CHANNEL = gql`
  query GetSlackChannel($id: ID!) {
    slackChannel(id: $id) {
      id
      name
      isPrivate
      isIm
      isMpim
      isArchived
      topic
      purpose
      memberCount
      unreadCount
    }
  }
`;

interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isIm: boolean;
  isMpim: boolean;
  isArchived?: boolean;
  topic?: string;
  purpose?: string;
  memberCount?: number;
  unreadCount?: number;
}

interface WidgetProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  compact: boolean;
  messageId: string;
}

function SlackChannelChip({
  channel,
  loading,
  label,
}: {
  channel?: SlackChannel;
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

  if (!channel) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '1px 6px', borderRadius: '4px', fontSize: '12px',
        background: 'var(--surface-subtle)', color: 'var(--text-muted)',
      }}>
        {label || 'Unknown channel'}
      </span>
    );
  }

  const prefix = channel.isIm ? '@' : channel.isPrivate ? '&#128274; ' : '#';
  const displayName = channel.isIm ? channel.name : channel.name;

  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '1px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 500,
        background: '#36C5F0', color: '#fff',
        maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
      dangerouslySetInnerHTML={{ __html: `${prefix}${displayName}` }}
    />
  );
}

function SlackChannelCard({
  channel,
  loading,
  error,
}: {
  channel?: SlackChannel;
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

  if (error || !channel) {
    return (
      <div style={{
        padding: '12px 16px', borderRadius: '8px',
        border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)',
        color: 'var(--text-muted)', fontSize: '12px',
      }}>
        {error ? `Failed to load channel: ${error.message}` : 'Channel not found'}
      </div>
    );
  }

  return (
    <div style={{
      padding: '12px 16px', borderRadius: '8px',
      borderTop: '1px solid var(--border-muted)',
      borderRight: '1px solid var(--border-muted)',
      borderBottom: '1px solid var(--border-muted)',
      borderLeft: '3px solid #36C5F0',
      background: 'var(--surface-subtle)',
    }}>
      {/* Header: Name + Badges */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#36C5F0' }}>
          {channel.isIm ? `@${channel.name}` : `#${channel.name}`}
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {channel.isPrivate && (
            <span style={{
              fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
              background: 'var(--surface-hover)', color: 'var(--text-secondary)', fontWeight: 500,
            }}>
              Private
            </span>
          )}
          {channel.isArchived && (
            <span style={{
              fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
              background: 'var(--surface-hover)', color: 'var(--text-muted)', fontWeight: 500,
            }}>
              Archived
            </span>
          )}
        </div>
      </div>

      {/* Topic */}
      {channel.topic && (
        <div style={{
          fontSize: '12px', color: 'var(--text-secondary)',
          marginBottom: '8px', lineHeight: 1.3,
        }}>
          {channel.topic}
        </div>
      )}

      {/* Metadata row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
        {channel.memberCount != null && (
          <span>{channel.memberCount} members</span>
        )}
        {(channel.unreadCount ?? 0) > 0 && (
          <span style={{ color: 'var(--status-error, #e5484d)', fontWeight: 600 }}>
            {channel.unreadCount} unread
          </span>
        )}
      </div>
    </div>
  );
}

export default function SlackChannelWidget({
  uri,
  entityType,
  pathSegments,
  label,
  compact,
}: WidgetProps) {
  const channelId = pathSegments[0];

  const { data, loading, error } = useEntityQuery(GET_SLACK_CHANNEL, {
    variables: { id: channelId },
    skip: !channelId,
  });

  const channel = data?.slackChannel as SlackChannel | undefined;

  if (error) {
    logger.error('Failed to load slack channel for widget', {
      channelId, uri, error: error.message,
    });
  }

  if (compact) {
    return <SlackChannelChip channel={channel} loading={loading} label={label} />;
  }
  return <SlackChannelCard channel={channel} loading={loading} error={error} />;
}
