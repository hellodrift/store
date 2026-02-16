import { NavSection, NavItem, NavHeaderActions, NavSettingsButton } from '@drift/ui/components';
import { MessageIcon, HashIcon, LockIcon, PersonIcon } from '@drift/ui/components';
import { useEntityQuery, gql, logger, useEntityDrawer, useEntitySelection, buildEntityURI } from '@drift/plugin-api';
import { useSlackSettings, buildTypesString } from './useSlackSettings';

const GET_SLACK_CHANNELS = gql`
  query GetSlackChannels($types: String, $limit: Int) {
    slackChannels(types: $types, limit: $limit) {
      id
      name
      isPrivate
      isIm
      isMpim
      topic
      memberCount
      unreadCount
    }
  }
`;

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

function ChannelIcon({ channel }: { channel: SlackChannelItem }) {
  if (channel.isIm) return <PersonIcon size={12} />;
  if (channel.isPrivate) return <LockIcon size={12} />;
  return <HashIcon size={12} />;
}

export default function SlackNav() {
  const [settings] = useSlackSettings();
  const { select } = useEntitySelection();
  const { openEntityDrawer } = useEntityDrawer();

  const typesString = buildTypesString(settings.channelTypes);

  const { data, loading, error } = useEntityQuery(GET_SLACK_CHANNELS, {
    variables: { types: typesString, limit: settings.limit },
    pollInterval: settings.pollInterval,
  });

  const channels: SlackChannelItem[] = data?.slackChannels ?? [];

  const sorted = [...channels].sort((a, b) => {
    if (settings.sortOrder === 'unread_first') {
      const unreadA = a.unreadCount ?? 0;
      const unreadB = b.unreadCount ?? 0;
      if (unreadA !== unreadB) return unreadB - unreadA;
    }
    return a.name.localeCompare(b.name);
  });

  const totalUnread = sorted.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);

  const section = {
    id: 'slack-channels',
    label: `Slack${channels.length ? ` (${channels.length})` : ''}`,
    icon: <MessageIcon size={12} />,
    items: [],
    isLoading: loading && !data,
    emptyState: error && !data ? error.message : 'No channels found',
    hasNotification: totalUnread > 0,
    notificationCount: totalUnread > 0 ? totalUnread : undefined,
    hoverActions: (
      <NavHeaderActions>
        <NavSettingsButton
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            select({ id: 'settings', type: 'drawer', data: {} });
          }}
          ariaLabel="Slack settings"
        />
      </NavHeaderActions>
    ),
  };

  if (error && !data) {
    logger.error('Failed to load Slack channels', { error: error.message });
  }

  return (
    <NavSection section={section}>
      {sorted.map((channel) => (
        <NavItem
          key={channel.id}
          item={{
            id: channel.id,
            label: channel.isIm ? channel.name : `${channel.name}`,
            variant: 'item' as const,
            icon: <ChannelIcon channel={channel} />,
            hasNotification: (channel.unreadCount ?? 0) > 0,
            notificationColor: channel.isIm ? 'var(--brand-primary, #6e56cf)' : undefined,
          }}
          onSelect={() => {
            logger.info('Slack channel selected', { channelId: channel.id, name: channel.name });
            openEntityDrawer(buildEntityURI('slack_channel', channel.id, channel.name));
          }}
        />
      ))}
    </NavSection>
  );
}
