import type { DesignMeta, DesignExample } from '../../../apps/canvas/src/canvas/types';
import { DrawerPreviewShell } from '../../../apps/canvas/src/canvas/DrawerPreviewShell';
import MessageDrawerContent from './MessageDrawerContent';
import type { MessageDrawerContentProps, SlackMessageData } from './MessageDrawerContent';

export const meta: DesignMeta<MessageDrawerContentProps> = {
  component: MessageDrawerContent,
  name: 'MessageDrawerContent',
  description: 'Full-featured Slack message detail panel with thread replies, reactions, and quick actions.',
  category: 'composed',
  tags: ['plugin', 'slack', 'drawer', 'entity-drawer', 'message', 'detail'],
  props: {
    message: {
      type: 'SlackMessageData',
      description: 'Message data to display',
      control: 'object',
    },
    threadMessages: {
      type: 'SlackMessageData[]',
      description: 'Thread reply messages (including parent)',
      control: 'object',
    },
    entityUri: {
      type: 'string',
      description: 'Entity URI for workstream linking',
      control: 'text',
    },
    linkedWorkstreams: {
      type: 'LinkedWorkstream[]',
      description: 'Workstreams linked to this message',
      control: 'object',
    },
    activeWorkstreams: {
      type: 'ActiveWorkstream[]',
      description: 'Available workstreams to link to',
      control: 'object',
    },
  },
};

const defaultMessage: SlackMessageData = {
  id: 'C001-1234567890.123456',
  text: 'Hey team, the deploy went smoothly! All services are green.',
  userId: 'U001',
  userName: 'Sarah Chen',
  channelId: 'C001',
  channelName: 'engineering',
  ts: '1234567890.123456',
  threadTs: '1234567890.123456',
  replyCount: 2,
  reactions: [{ name: 'tada', count: 5 }, { name: 'rocket', count: 2 }],
  timestamp: '2026-02-15T10:30:00Z',
  url: 'https://slack.com/archives/C001/p1234567890123456',
};

const threadReplies: SlackMessageData[] = [
  {
    id: 'C001-1234567891.100000',
    text: 'Awesome work! The monitoring looks clean too.',
    userId: 'U002',
    userName: 'Alex Kim',
    channelId: 'C001',
    channelName: 'engineering',
    ts: '1234567891.100000',
    replyCount: 0,
    reactions: [],
    timestamp: '2026-02-15T10:32:00Z',
  },
  {
    id: 'C001-1234567892.200000',
    text: 'Nice. I confirmed the latency numbers are back to normal.',
    userId: 'U003',
    userName: 'Jordan Lee',
    channelId: 'C001',
    channelName: 'engineering',
    ts: '1234567892.200000',
    replyCount: 0,
    reactions: [{ name: 'thumbsup', count: 1 }],
    timestamp: '2026-02-15T10:35:00Z',
  },
];

export const Default: DesignExample<MessageDrawerContentProps> = {
  name: 'Default',
  description: 'Full message with thread replies, reactions, and linked workstreams',
  args: {
    message: defaultMessage,
    threadMessages: [defaultMessage, ...threadReplies],
    entityUri: '@drift//slack_message/C001/1234567890.123456',
    linkedWorkstreams: [
      { id: 'link-1', title: 'Deploy monitoring', status: 'active', relationship: 'linked' },
    ],
    activeWorkstreams: [
      { id: 'ws-2', title: 'Sprint review prep', status: 'active' },
      { id: 'ws-3', title: 'Infrastructure upgrades', status: 'paused' },
    ],
  },
  render: (args) => (
    <DrawerPreviewShell title="Message">
      <MessageDrawerContent
        message={args.message!}
        threadMessages={args.threadMessages}
        entityUri={args.entityUri}
        linkedWorkstreams={args.linkedWorkstreams}
        activeWorkstreams={args.activeWorkstreams}
      />
    </DrawerPreviewShell>
  ),
};

export const NoThread: DesignExample<MessageDrawerContentProps> = {
  name: 'No Thread',
  description: 'Single message with no replies',
  args: {
    message: { ...defaultMessage, replyCount: 0, threadTs: undefined },
    threadMessages: [],
  },
  render: (args) => (
    <DrawerPreviewShell title="Message">
      <MessageDrawerContent
        message={args.message!}
        threadMessages={args.threadMessages}
      />
    </DrawerPreviewShell>
  ),
};

export const WithReactions: DesignExample<MessageDrawerContentProps> = {
  name: 'With Reactions',
  description: 'Message with many reactions and no thread',
  args: {
    message: {
      ...defaultMessage,
      reactions: [
        { name: 'tada', count: 5 },
        { name: 'rocket', count: 3 },
        { name: 'heart', count: 2 },
        { name: 'fire', count: 1 },
        { name: 'eyes', count: 4 },
      ],
      replyCount: 0,
      threadTs: undefined,
    },
    threadMessages: [],
  },
  render: (args) => (
    <DrawerPreviewShell title="Message">
      <MessageDrawerContent
        message={args.message!}
        threadMessages={args.threadMessages}
      />
    </DrawerPreviewShell>
  ),
};

export const Minimal: DesignExample<MessageDrawerContentProps> = {
  name: 'Minimal',
  description: 'Message with only required fields, no optional data',
  args: {
    message: {
      id: 'C010-9999999999.000000',
      text: 'Quick update.',
      userId: 'U099',
      channelId: 'C010',
      ts: '9999999999.000000',
    },
  },
  render: (args) => (
    <DrawerPreviewShell title="Message">
      <MessageDrawerContent message={args.message!} />
    </DrawerPreviewShell>
  ),
};

export const LongThread: DesignExample<MessageDrawerContentProps> = {
  name: 'Long Thread',
  description: 'Message with many thread replies to verify scrolling behavior',
  args: {
    message: {
      ...defaultMessage,
      text: 'What should we name the new service?',
      replyCount: 5,
    },
    threadMessages: [
      { ...defaultMessage, text: 'What should we name the new service?', replyCount: 5 },
      { id: 'C001-r1', text: 'How about "gateway"?', userId: 'U002', userName: 'Alex Kim', channelId: 'C001', ts: '1234567891.000000' },
      { id: 'C001-r2', text: 'I prefer "router" — it describes what it does.', userId: 'U003', userName: 'Jordan Lee', channelId: 'C001', ts: '1234567892.000000' },
      { id: 'C001-r3', text: '+1 for router, clearer intent.', userId: 'U004', userName: 'Priya Patel', channelId: 'C001', ts: '1234567893.000000', reactions: [{ name: 'thumbsup', count: 3 }] },
      { id: 'C001-r4', text: 'What about "edge-proxy"? We already have a "router" in the monorepo.', userId: 'U005', userName: 'Marcus Davis', channelId: 'C001', ts: '1234567894.000000' },
      { id: 'C001-r5', text: 'Good point. Let\'s go with edge-proxy then. I\'ll update the RFC.', userId: 'U001', userName: 'Sarah Chen', channelId: 'C001', ts: '1234567895.000000', reactions: [{ name: 'white_check_mark', count: 4 }] },
    ],
  },
  render: (args) => (
    <DrawerPreviewShell title="Message" height={700}>
      <MessageDrawerContent
        message={args.message!}
        threadMessages={args.threadMessages}
      />
    </DrawerPreviewShell>
  ),
};
