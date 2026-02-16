import type { DesignMeta, DesignExample } from '../../../apps/canvas/src/canvas/types';

interface SlackChannelItem {
  id: string;
  name: string;
  isPrivate: boolean;
  isIm: boolean;
  isMpim: boolean;
  topic?: string;
  memberCount?: number;
  unreadCount?: number;
}

interface DesignNavProps {
  channels: SlackChannelItem[];
  loading?: boolean;
  error?: string;
}

function ChannelIcon({ channel }: { channel: SlackChannelItem }) {
  if (channel.isIm) return <span style={{ fontSize: 12 }}>@</span>;
  if (channel.isPrivate) return <span style={{ fontSize: 12 }}>&#128274;</span>;
  return <span style={{ fontSize: 12 }}>#</span>;
}

function SlackNavDesign({ channels, loading, error }: DesignNavProps) {
  if (loading) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
        Loading channels...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--status-error)' }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
        Slack ({channels.length})
      </div>
      {channels.map((channel) => (
        <div
          key={channel.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 12px',
            fontSize: 12,
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          <ChannelIcon channel={channel} />
          <span style={{ flex: 1 }}>{channel.name}</span>
          {(channel.unreadCount ?? 0) > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#fff',
                background: 'var(--status-error, #e5484d)',
                borderRadius: 8,
                padding: '0 5px',
                minWidth: 16,
                textAlign: 'center',
                lineHeight: '16px',
              }}
            >
              {channel.unreadCount}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export const meta: DesignMeta<DesignNavProps> = {
  component: SlackNavDesign,
  name: 'SlackNavSection',
  description: 'Sidebar navigation section showing Slack channels and DMs.',
  category: 'composed',
  tags: ['plugin', 'slack', 'nav-sidebar'],
  props: {
    channels: { type: 'SlackChannelItem[]', description: 'Channel list', control: 'object' },
    loading: { type: 'boolean', description: 'Loading state', control: 'boolean' },
    error: { type: 'string | undefined', description: 'Error message', control: 'text' },
  },
};

export const Default: DesignExample<DesignNavProps> = {
  name: 'Default',
  description: 'Channel list with mix of types and unread counts',
  args: {
    channels: [
      { id: 'C001', name: 'general', isPrivate: false, isIm: false, isMpim: false, unreadCount: 3 },
      { id: 'C002', name: 'engineering', isPrivate: false, isIm: false, isMpim: false, unreadCount: 0 },
      { id: 'C003', name: 'design-team', isPrivate: true, isIm: false, isMpim: false, unreadCount: 1 },
      { id: 'D001', name: 'alice', isPrivate: false, isIm: true, isMpim: false, unreadCount: 5 },
      { id: 'C004', name: 'random', isPrivate: false, isIm: false, isMpim: false, unreadCount: 0 },
    ],
  },
};

export const Loading: DesignExample<DesignNavProps> = {
  name: 'Loading',
  description: 'Loading state',
  args: { channels: [], loading: true },
};

export const Empty: DesignExample<DesignNavProps> = {
  name: 'Empty',
  description: 'No channels found',
  args: { channels: [] },
};
