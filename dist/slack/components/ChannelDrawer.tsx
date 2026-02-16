import { useEffect, useRef } from 'react';
import { DrawerHeaderTitle, DrawerBody } from '@drift/ui';
import { useEntityQuery, useEntityMutation, gql, logger, useWorkstreamLinker } from '@drift/plugin-api';
import ChannelDrawerContent from './ChannelDrawerContent';

// ────────────────────────────────────────────────────────────────────────────
// GraphQL Queries
// ────────────────────────────────────────────────────────────────────────────

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

const GET_SLACK_MESSAGES = gql`
  query GetSlackMessages($channelId: ID!, $limit: Int) {
    slackMessages(channelId: $channelId, limit: $limit) {
      id
      text
      userId
      userName
      userAvatar
      channelId
      channelName
      ts
      threadTs
      replyCount
      reactions { name count }
      timestamp
    }
  }
`;

const GET_SLACK_USERS = gql`
  query GetSlackUsers($limit: Int) {
    slackUsers(limit: $limit) {
      id
      name
      displayName
      avatar
      isBot
    }
  }
`;


// ────────────────────────────────────────────────────────────────────────────
// GraphQL Mutations
// ────────────────────────────────────────────────────────────────────────────

const SEND_MESSAGE = gql`
  mutation SendSlackMessage($channelId: ID!, $text: String!, $threadTs: String) {
    sendSlackMessage(channelId: $channelId, text: $text, threadTs: $threadTs) {
      success
      message
    }
  }
`;

const MARK_READ = gql`
  mutation MarkSlackChannelRead($channelId: ID!, $ts: String!) {
    markSlackChannelRead(channelId: $channelId, ts: $ts) {
      success
      message
    }
  }
`;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function buildEntityUri(channelId: string): string {
  return `@drift//slack_channel/${channelId}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

interface EntityDrawerProps {
  entityId: string;
  entityType: string;
  label?: string;
  drawer: {
    close: () => void;
    open: (uri: string) => void;
    push: (uri: string) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

export default function ChannelDrawer({ entityId, label, drawer }: EntityDrawerProps) {
  // ── Queries ──────────────────────────────────────────────────────────────
  const { data, loading, error, refetch: refetchChannel } = useEntityQuery(GET_SLACK_CHANNEL, {
    variables: { id: entityId },
  });

  const channel = data?.slackChannel;

  const { data: messagesData, loading: messagesLoading, refetch: refetchMessages } = useEntityQuery(
    GET_SLACK_MESSAGES,
    {
      variables: { channelId: entityId, limit: 30 },
    },
  );

  const { data: usersData } = useEntityQuery(GET_SLACK_USERS, {
    variables: { limit: 100 },
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const [sendMessage] = useEntityMutation(SEND_MESSAGE);
  const [markRead] = useEntityMutation(MARK_READ);

  // ── Workstream linking (via SDK hook) ──────────────────────────────────
  const entityUri = buildEntityUri(entityId);
  const workstreamLinker = useWorkstreamLinker(entityUri, 'slack_channel');

  // ── Auto mark-as-read on open ────────────────────────────────────────────
  const markedReadRef = useRef(false);
  useEffect(() => {
    const messages = messagesData?.slackMessages;
    if (markedReadRef.current || !messages?.length) return;
    markedReadRef.current = true;
    const latestTs = messages[0].ts;
    markRead({ variables: { channelId: entityId, ts: latestTs } })
      .then(() => refetchChannel())
      .catch((err: any) => logger.error('Auto mark-as-read failed', { error: err?.message }));
  }, [messagesData]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSendMessage = async (text: string) => {
    try {
      await sendMessage({ variables: { channelId: entityId, text } });
      refetchMessages();
    } catch (err: any) {
      logger.error('Failed to send message', { error: err?.message });
    }
  };

  const handleMarkRead = async () => {
    const messages = messagesData?.slackMessages;
    if (!messages?.length) return;
    const latestTs = messages[0].ts;
    try {
      await markRead({ variables: { channelId: entityId, ts: latestTs } });
      refetchChannel();
    } catch (err: any) {
      logger.error('Failed to mark as read', { error: err?.message });
    }
  };

  const handleOpenThread = (channelId: string, ts: string) => {
    // Build URI with literal slashes so parseEntityURI produces two path segments
    // (buildEntityURI would encode the slash, collapsing them into one segment)
    drawer.push(`@drift//slack_message/${channelId}/${ts}`);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading && !channel) {
    return (
      <>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <DrawerBody className="text-muted-foreground text-[13px]">
          Loading channel...
        </DrawerBody>
      </>
    );
  }

  if (error && !channel) {
    return (
      <>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <DrawerBody className="text-muted-foreground text-[13px]">
          Failed to load channel: {error.message}
        </DrawerBody>
      </>
    );
  }

  if (!channel) {
    return (
      <DrawerBody className="text-muted-foreground text-[13px]">
        Channel not found
      </DrawerBody>
    );
  }

  return (
    <ChannelDrawerContent
      channel={channel}
      messages={messagesData?.slackMessages ?? []}
      messagesLoading={messagesLoading}
      users={usersData?.slackUsers}
      onSendMessage={handleSendMessage}
      onMarkRead={handleMarkRead}
      onOpenThread={handleOpenThread}
      entityUri={entityUri}
      linkedWorkstreams={workstreamLinker.linkedWorkstreams}
      activeWorkstreams={workstreamLinker.activeWorkstreams}
      onLinkWorkstream={workstreamLinker.linkWorkstream}
      onUnlinkWorkstream={workstreamLinker.unlinkWorkstream}
      onStartWorkstream={(_id, title) => workstreamLinker.startWorkstream(title)}
    />
  );
}
