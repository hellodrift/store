import type { DesignMeta, DesignExample } from '../../../apps/canvas/src/canvas/types';
import { DrawerPreviewShell } from '../../../apps/canvas/src/canvas/DrawerPreviewShell';
import ChannelDrawerContent from './ChannelDrawerContent';
import type { ChannelDrawerContentProps, SlackChannel, SlackMessageItem } from './ChannelDrawerContent';

export const meta: DesignMeta<ChannelDrawerContentProps> = {
  component: ChannelDrawerContent,
  name: 'ChannelDrawerContent',
  description: 'Full-featured Slack channel detail panel with messages, topic, compose input, and workstream linking.',
  category: 'composed',
  tags: ['plugin', 'slack', 'drawer', 'entity-drawer', 'channel', 'detail'],
  props: {
    channel: { type: 'SlackChannel', description: 'Channel data to display', control: 'object' },
    messages: { type: 'SlackMessageItem[]', description: 'Channel messages', control: 'object' },
    messagesLoading: { type: 'boolean', description: 'Loading state for messages', control: 'boolean' },
    users: { type: 'SlackUser[]', description: 'Workspace users for display names', control: 'object' },
    entityUri: { type: 'string', description: 'Entity URI for workstream linking', control: 'text' },
    linkedWorkstreams: { type: 'LinkedWorkstream[]', description: 'Linked workstreams', control: 'object' },
    activeWorkstreams: { type: 'ActiveWorkstream[]', description: 'Available workstreams', control: 'object' },
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

const sampleMessages: SlackMessageItem[] = [
  {
    id: 'C001-1234567890.100000',
    text: 'Hey team, the deploy went smoothly! All services are green.',
    userId: 'U001',
    userName: 'Sarah Chen',
    channelId: 'C001',
    channelName: 'engineering',
    ts: '1234567890.100000',
    replyCount: 3,
    reactions: [{ name: 'tada', count: 5 }],
  },
  {
    id: 'C001-1234567891.200000',
    text: 'Great news! I also pushed the fix for the auth bug we discussed yesterday.',
    userId: 'U002',
    userName: 'Alex Kim',
    channelId: 'C001',
    channelName: 'engineering',
    ts: '1234567891.200000',
    replyCount: 0,
    reactions: [{ name: 'thumbsup', count: 2 }],
  },
  {
    id: 'C001-1234567892.300000',
    text: 'Can someone review my PR? It updates the query optimization layer.',
    userId: 'U003',
    userName: 'Jordan Lee',
    channelId: 'C001',
    channelName: 'engineering',
    ts: '1234567892.300000',
    replyCount: 1,
  },
];

export const Default: DesignExample<ChannelDrawerContentProps> = {
  name: 'Default',
  description: 'Channel with messages, topic, and linked workstreams',
  args: {
    channel: defaultChannel,
    messages: sampleMessages,
    messagesLoading: false,
    entityUri: '@drift//slack_channel/C001',
    linkedWorkstreams: [
      { id: 'link-1', title: 'Sprint 14 standup', status: 'active', relationship: 'linked' },
    ],
    activeWorkstreams: [
      { id: 'ws-2', title: 'API refactoring sprint', status: 'active' },
      { id: 'ws-3', title: 'Design system overhaul', status: 'paused' },
    ],
  },
  render: (args) => (
    <DrawerPreviewShell title="#engineering">
      <ChannelDrawerContent
        channel={args.channel!}
        messages={args.messages!}
        messagesLoading={args.messagesLoading ?? false}
        entityUri={args.entityUri}
        linkedWorkstreams={args.linkedWorkstreams}
        activeWorkstreams={args.activeWorkstreams}
      />
    </DrawerPreviewShell>
  ),
};

export const Loading: DesignExample<ChannelDrawerContentProps> = {
  name: 'Loading',
  description: 'Channel drawer while messages are loading',
  args: { channel: defaultChannel, messages: [], messagesLoading: true },
  render: (args) => (
    <DrawerPreviewShell title="#engineering">
      <ChannelDrawerContent
        channel={args.channel!}
        messages={args.messages!}
        messagesLoading={args.messagesLoading ?? true}
      />
    </DrawerPreviewShell>
  ),
};

export const Empty: DesignExample<ChannelDrawerContentProps> = {
  name: 'Empty',
  description: 'Channel with no messages',
  args: { channel: defaultChannel, messages: [], messagesLoading: false },
  render: (args) => (
    <DrawerPreviewShell title="#engineering">
      <ChannelDrawerContent
        channel={args.channel!}
        messages={args.messages!}
        messagesLoading={args.messagesLoading ?? false}
      />
    </DrawerPreviewShell>
  ),
};

export const PrivateChannel: DesignExample<ChannelDrawerContentProps> = {
  name: 'Private Channel',
  description: 'Private channel with restricted access',
  args: {
    channel: {
      id: 'C002',
      name: 'design-team',
      isPrivate: true,
      isIm: false,
      isMpim: false,
      topic: 'Design discussions — keep it visual',
      memberCount: 8,
      unreadCount: 0,
    },
    messages: sampleMessages.slice(0, 1),
    messagesLoading: false,
  },
  render: (args) => (
    <DrawerPreviewShell title="#design-team">
      <ChannelDrawerContent
        channel={args.channel!}
        messages={args.messages!}
        messagesLoading={args.messagesLoading ?? false}
      />
    </DrawerPreviewShell>
  ),
};

export const DirectMessage: DesignExample<ChannelDrawerContentProps> = {
  name: 'Direct Message',
  description: 'One-on-one DM conversation',
  args: {
    channel: {
      id: 'D001',
      name: 'alice',
      isPrivate: false,
      isIm: true,
      isMpim: false,
      memberCount: 2,
    },
    messages: [
      {
        id: 'D001-100.000',
        text: 'Hey, are you free for a quick sync?',
        userId: 'U010',
        userName: 'alice',
        channelId: 'D001',
        ts: '1234567890.000000',
        replyCount: 0,
      },
      {
        id: 'D001-101.000',
        text: 'Sure, give me 5 minutes.',
        userId: 'U001',
        userName: 'Sarah Chen',
        channelId: 'D001',
        ts: '1234567891.000000',
        replyCount: 0,
      },
    ],
    messagesLoading: false,
  },
  render: (args) => (
    <DrawerPreviewShell title="@alice">
      <ChannelDrawerContent
        channel={args.channel!}
        messages={args.messages!}
        messagesLoading={args.messagesLoading ?? false}
      />
    </DrawerPreviewShell>
  ),
};

export const ManyMessages: DesignExample<ChannelDrawerContentProps> = {
  name: 'Many Messages',
  description: 'Channel with many messages to verify scroll behavior',
  args: {
    channel: defaultChannel,
    messages: [
      ...sampleMessages,
      {
        id: 'C001-1234567893.400000',
        text: 'Merged! Thanks for the review.',
        userId: 'U003',
        userName: 'Jordan Lee',
        channelId: 'C001',
        ts: '1234567893.400000',
        replyCount: 0,
      },
      {
        id: 'C001-1234567894.500000',
        text: 'Reminder: retro is in 30 minutes. Please add your items to the board.',
        userId: 'U004',
        userName: 'Priya Patel',
        channelId: 'C001',
        ts: '1234567894.500000',
        replyCount: 2,
        reactions: [{ name: 'eyes', count: 3 }],
      },
      {
        id: 'C001-1234567895.600000',
        text: 'FYI — I updated the staging environment with the new config. Let me know if anything looks off.',
        userId: 'U005',
        userName: 'Marcus Davis',
        channelId: 'C001',
        ts: '1234567895.600000',
        replyCount: 0,
        reactions: [{ name: 'thumbsup', count: 1 }],
      },
    ],
    messagesLoading: false,
  },
  render: (args) => (
    <DrawerPreviewShell title="#engineering" height={700}>
      <ChannelDrawerContent
        channel={args.channel!}
        messages={args.messages!}
        messagesLoading={args.messagesLoading ?? false}
      />
    </DrawerPreviewShell>
  ),
};
