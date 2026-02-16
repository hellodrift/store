import type { DesignMeta, DesignExample } from '../../../apps/canvas/src/canvas/types';

/**
 * Presentational wrapper for SlackChannelWidget design previews.
 * The real component uses useEntityQuery which isn't available in the canvas,
 * so we render the chip/card UI directly with mock data.
 */

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

interface DesignWidgetProps {
  channel?: SlackChannel;
  compact: boolean;
  loading?: boolean;
  error?: string;
}

function SlackChannelChip({ channel, loading }: { channel?: SlackChannel; loading?: boolean }) {
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

  if (!channel) return null;

  const prefix = channel.isIm ? '@' : '#';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '1px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 500,
      background: '#36C5F0', color: '#fff',
      maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {prefix}{channel.name}
    </span>
  );
}

function SlackChannelCard({ channel, loading, error }: { channel?: SlackChannel; loading?: boolean; error?: string }) {
  if (loading) {
    return (
      <div style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)' }}>
        <div style={{ height: '14px', width: '80px', borderRadius: '4px', background: 'var(--surface-hover)', marginBottom: '8px' }} />
        <div style={{ height: '12px', width: '200px', borderRadius: '4px', background: 'var(--surface-hover)' }} />
      </div>
    );
  }

  if (error || !channel) {
    return (
      <div style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)', color: 'var(--text-muted)', fontSize: '12px' }}>
        {error ? `Failed to load channel: ${error}` : 'Channel not found'}
      </div>
    );
  }

  return (
    <div style={{
      padding: '12px 16px', borderRadius: '8px',
      borderTop: '1px solid var(--border-muted)', borderRight: '1px solid var(--border-muted)',
      borderBottom: '1px solid var(--border-muted)', borderLeft: '3px solid #36C5F0',
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
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', lineHeight: 1.3 }}>
          {channel.topic}
        </div>
      )}

      {/* Purpose (if different from topic) */}
      {channel.purpose && channel.purpose !== channel.topic && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.3, fontStyle: 'italic' }}>
          {channel.purpose}
        </div>
      )}

      {/* Metadata row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
        {channel.memberCount != null && <span>{channel.memberCount} members</span>}
        {(channel.unreadCount ?? 0) > 0 && (
          <span style={{ color: 'var(--status-error, #e5484d)', fontWeight: 600 }}>
            {channel.unreadCount} unread
          </span>
        )}
      </div>
    </div>
  );
}

function SlackChannelWidgetDesign({ channel, compact, loading, error }: DesignWidgetProps) {
  if (compact) {
    return <SlackChannelChip channel={channel} loading={loading} />;
  }
  return <SlackChannelCard channel={channel} loading={loading} error={error} />;
}

export const meta: DesignMeta<DesignWidgetProps> = {
  component: SlackChannelWidgetDesign,
  name: 'SlackChannelWidget',
  description: 'Entity widget for rendering slack_channel entities as inline chips or block cards in chat messages. Overrides the default entity card with Slack-branded styling.',
  category: 'composed',
  tags: ['plugin', 'slack', 'entity-widget', 'chip', 'card', 'channel'],
  props: {
    channel: { type: 'SlackChannel | undefined', description: 'Channel data to render', control: 'object' },
    compact: { type: 'boolean', description: 'true = inline chip, false = block card', control: 'boolean' },
    loading: { type: 'boolean', description: 'Show loading state', control: 'boolean' },
    error: { type: 'string | undefined', description: 'Error message to display', control: 'text' },
  },
};

const defaultChannel: SlackChannel = {
  id: 'C001',
  name: 'engineering',
  isPrivate: false,
  isIm: false,
  isMpim: false,
  topic: 'Engineering team discussions and updates',
  purpose: 'A place for the engineering team to collaborate',
  memberCount: 42,
  unreadCount: 3,
};

export const ChipDefault: DesignExample<DesignWidgetProps> = {
  name: 'Chip Default',
  description: 'Compact inline chip with channel name',
  args: { channel: defaultChannel, compact: true },
};

export const ChipPrivate: DesignExample<DesignWidgetProps> = {
  name: 'Chip Private',
  description: 'Private channel chip',
  args: {
    channel: { ...defaultChannel, id: 'C002', name: 'design-team', isPrivate: true },
    compact: true,
  },
};

export const ChipDM: DesignExample<DesignWidgetProps> = {
  name: 'Chip DM',
  description: 'Direct message chip with @ prefix',
  args: {
    channel: { id: 'D001', name: 'alice', isPrivate: false, isIm: true, isMpim: false },
    compact: true,
  },
};

export const ChipLoading: DesignExample<DesignWidgetProps> = {
  name: 'Chip Loading',
  description: 'Loading shimmer state for inline chip',
  args: { compact: true, loading: true },
};

export const CardDefault: DesignExample<DesignWidgetProps> = {
  name: 'Card Default',
  description: 'Full card with topic, purpose, member count, and unread badge',
  args: { channel: defaultChannel, compact: false },
};

export const CardPrivate: DesignExample<DesignWidgetProps> = {
  name: 'Card Private',
  description: 'Private channel card with badge',
  args: {
    channel: {
      ...defaultChannel,
      id: 'C002',
      name: 'design-team',
      isPrivate: true,
      topic: 'Design discussions — keep it visual',
      memberCount: 8,
      unreadCount: 0,
    },
    compact: false,
  },
};

export const CardDM: DesignExample<DesignWidgetProps> = {
  name: 'Card DM',
  description: 'Direct message card with @ prefix',
  args: {
    channel: {
      id: 'D001',
      name: 'alice',
      isPrivate: false,
      isIm: true,
      isMpim: false,
      memberCount: 2,
    },
    compact: false,
  },
};

export const CardWithUnread: DesignExample<DesignWidgetProps> = {
  name: 'Card With Unread',
  description: 'Channel card with high unread count highlighted in red',
  args: {
    channel: {
      ...defaultChannel,
      id: 'C005',
      name: 'general',
      unreadCount: 47,
      memberCount: 128,
      topic: 'Company-wide announcements and updates',
    },
    compact: false,
  },
};

export const CardArchived: DesignExample<DesignWidgetProps> = {
  name: 'Card Archived',
  description: 'Archived channel card with badge',
  args: {
    channel: {
      ...defaultChannel,
      id: 'C099',
      name: 'old-project',
      isArchived: true,
      topic: 'This project has been sunset',
      unreadCount: 0,
      memberCount: 15,
    },
    compact: false,
  },
};

export const CardLoading: DesignExample<DesignWidgetProps> = {
  name: 'Card Loading',
  description: 'Skeleton loading state for block card',
  args: { compact: false, loading: true },
};

export const CardError: DesignExample<DesignWidgetProps> = {
  name: 'Card Error',
  description: 'Error state when channel fails to load',
  args: { compact: false, error: 'channel_not_found' },
};
