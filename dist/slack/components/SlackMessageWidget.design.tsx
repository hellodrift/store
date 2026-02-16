import type { DesignMeta, DesignExample } from '../../../apps/canvas/src/canvas/types';

/**
 * Presentational wrapper for SlackMessageWidget design previews.
 * The real component uses useEntityQuery which isn't available in the canvas,
 * so we render the chip/card UI directly with mock data.
 */

interface SlackMessage {
  id: string;
  text: string;
  userId: string;
  userName?: string;
  userAvatar?: string;
  channelId: string;
  channelName?: string;
  ts: string;
  replyCount?: number;
  reactions?: { name: string; count: number }[];
  timestamp?: string;
}

interface DesignWidgetProps {
  message?: SlackMessage;
  compact: boolean;
  loading?: boolean;
  error?: string;
}

function SlackMessageChip({ message, loading }: { message?: SlackMessage; loading?: boolean }) {
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

  if (!message) return null;

  const preview = message.text.length > 50 ? message.text.slice(0, 50) + '...' : message.text;
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

function SlackMessageCard({ message, loading, error }: { message?: SlackMessage; loading?: boolean; error?: string }) {
  if (loading) {
    return (
      <div style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)' }}>
        <div style={{ height: '14px', width: '80px', borderRadius: '4px', background: 'var(--surface-hover)', marginBottom: '8px' }} />
        <div style={{ height: '12px', width: '200px', borderRadius: '4px', background: 'var(--surface-hover)' }} />
      </div>
    );
  }

  if (error || !message) {
    return (
      <div style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)', color: 'var(--text-muted)', fontSize: '12px' }}>
        {error ? `Failed to load message: ${error}` : 'Message not found'}
      </div>
    );
  }

  return (
    <div style={{
      padding: '12px 16px', borderRadius: '8px',
      borderTop: '1px solid var(--border-muted)', borderRight: '1px solid var(--border-muted)',
      borderBottom: '1px solid var(--border-muted)', borderLeft: '3px solid #4A154B',
      background: 'var(--surface-subtle)',
    }}>
      {/* Header: Channel + Time */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#4A154B' }}>
          {message.channelName ? `#${message.channelName}` : message.channelId}
        </span>
        {message.timestamp && (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {new Date(message.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
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

      {/* Metadata row: replies + reactions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
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

function SlackMessageWidgetDesign({ message, compact, loading, error }: DesignWidgetProps) {
  if (compact) {
    return <SlackMessageChip message={message} loading={loading} />;
  }
  return <SlackMessageCard message={message} loading={loading} error={error} />;
}

export const meta: DesignMeta<DesignWidgetProps> = {
  component: SlackMessageWidgetDesign,
  name: 'SlackMessageWidget',
  description: 'Entity widget for rendering slack_message entities as inline chips or block cards in chat messages. Overrides the default entity card with Slack-branded styling.',
  category: 'composed',
  tags: ['plugin', 'slack', 'entity-widget', 'chip', 'card', 'message'],
  props: {
    message: { type: 'SlackMessage | undefined', description: 'Message data to render', control: 'object' },
    compact: { type: 'boolean', description: 'true = inline chip, false = block card', control: 'boolean' },
    loading: { type: 'boolean', description: 'Show loading state', control: 'boolean' },
    error: { type: 'string | undefined', description: 'Error message to display', control: 'text' },
  },
};

const defaultMessage: SlackMessage = {
  id: 'C001-1234567890.123456',
  text: 'Hey team, the deploy went smoothly! All services are green.',
  userId: 'U001',
  userName: 'Sarah Chen',
  channelId: 'C001',
  channelName: 'engineering',
  ts: '1234567890.123456',
  replyCount: 3,
  reactions: [{ name: 'tada', count: 5 }, { name: 'rocket', count: 2 }],
  timestamp: '2026-02-15T10:30:00Z',
};

export const ChipDefault: DesignExample<DesignWidgetProps> = {
  name: 'Chip Default',
  description: 'Compact inline chip with channel, author, and message preview',
  args: { message: defaultMessage, compact: true },
};

export const ChipLoading: DesignExample<DesignWidgetProps> = {
  name: 'Chip Loading',
  description: 'Loading state for inline chip',
  args: { compact: true, loading: true },
};

export const ChipDM: DesignExample<DesignWidgetProps> = {
  name: 'Chip DM',
  description: 'Direct message chip without channel name',
  args: {
    message: {
      ...defaultMessage,
      channelId: 'D001',
      channelName: undefined,
      userName: 'alice',
      text: 'Can you review the PR when you get a chance?',
    },
    compact: true,
  },
};

export const CardDefault: DesignExample<DesignWidgetProps> = {
  name: 'Card Default',
  description: 'Full card with message, author, replies, and reactions',
  args: { message: defaultMessage, compact: false },
};

export const CardWithReactions: DesignExample<DesignWidgetProps> = {
  name: 'Card With Reactions',
  description: 'Card with many emoji reactions',
  args: {
    message: {
      ...defaultMessage,
      text: 'We just hit 1 million users! Incredible work everyone.',
      reactions: [
        { name: 'tada', count: 12 },
        { name: 'rocket', count: 8 },
        { name: 'heart', count: 6 },
        { name: 'fire', count: 4 },
        { name: 'star', count: 3 },
      ],
      replyCount: 15,
    },
    compact: false,
  },
};

export const CardThreaded: DesignExample<DesignWidgetProps> = {
  name: 'Card Threaded',
  description: 'Card showing a message with thread replies and no reactions',
  args: {
    message: {
      ...defaultMessage,
      text: 'RFC: Should we migrate to a monorepo? Thoughts below.',
      replyCount: 23,
      reactions: [],
    },
    compact: false,
  },
};

export const CardLoading: DesignExample<DesignWidgetProps> = {
  name: 'Card Loading',
  description: 'Skeleton loading state for block card',
  args: { compact: false, loading: true },
};

export const CardMinimal: DesignExample<DesignWidgetProps> = {
  name: 'Card Minimal',
  description: 'Card with only id and text, no optional fields',
  args: {
    message: {
      id: 'C010-9999.000',
      text: 'Quick update.',
      userId: 'U099',
      channelId: 'C010',
      ts: '9999999999.000000',
    },
    compact: false,
  },
};

export const CardError: DesignExample<DesignWidgetProps> = {
  name: 'Card Error',
  description: 'Error state when message fails to load',
  args: {
    compact: false,
    error: 'channel_not_found',
  },
};
