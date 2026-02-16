import { useEffect, useRef } from 'react';
import { DrawerHeaderTitle, DrawerBody } from '@drift/ui';
import { useEntityQuery, useEntityMutation, gql, logger, useWorkstreamLinker } from '@drift/plugin-api';
import MessageDrawerContent from './MessageDrawerContent';

// ────────────────────────────────────────────────────────────────────────────
// GraphQL Queries
// ────────────────────────────────────────────────────────────────────────────

const GET_SLACK_MESSAGE = gql`
  query GetSlackMessage($channelId: ID!, $ts: String!) {
    slackMessage(channelId: $channelId, ts: $ts) {
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
      url
    }
  }
`;

const GET_SLACK_THREAD = gql`
  query GetSlackThread($channelId: ID!, $threadTs: String!) {
    slackThread(channelId: $channelId, threadTs: $threadTs) {
      channelId
      threadTs
      replyCount
      messages {
        id
        text
        userId
        userName
        userAvatar
        ts
        timestamp
        reactions { name count }
      }
    }
  }
`;


// ────────────────────────────────────────────────────────────────────────────
// GraphQL Mutations
// ────────────────────────────────────────────────────────────────────────────

const SEND_REPLY = gql`
  mutation SendSlackReply($channelId: ID!, $text: String!, $threadTs: String) {
    sendSlackMessage(channelId: $channelId, text: $text, threadTs: $threadTs) {
      success
      message
    }
  }
`;

const ADD_REACTION = gql`
  mutation AddSlackReaction($channelId: ID!, $ts: String!, $emoji: String!) {
    addSlackReaction(channelId: $channelId, ts: $ts, emoji: $emoji) {
      success
      message
    }
  }
`;

const EDIT_MESSAGE = gql`
  mutation EditSlackMessage($channelId: ID!, $ts: String!, $text: String!) {
    editSlackMessage(channelId: $channelId, ts: $ts, text: $text) {
      success
      message
    }
  }
`;

const DELETE_MESSAGE = gql`
  mutation DeleteSlackMessage($channelId: ID!, $ts: String!) {
    deleteSlackMessage(channelId: $channelId, ts: $ts) {
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
// Component
// ────────────────────────────────────────────────────────────────────────────

interface EntityDrawerProps {
  entityId: string;
  entityType: string;
  label?: string;
  pathSegments?: string[];
  drawer: {
    close: () => void;
    open: (uri: string) => void;
    push: (uri: string) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

export default function MessageDrawer({ entityId, label, drawer, pathSegments }: EntityDrawerProps) {
  // Parse channelId and ts from entityId (format: "channelId-ts") or pathSegments
  let channelId: string;
  let ts: string;

  if (pathSegments && pathSegments.length >= 2) {
    channelId = pathSegments[0];
    ts = pathSegments[1];
  } else {
    const dashIdx = entityId.indexOf('-');
    channelId = dashIdx > 0 ? entityId.substring(0, dashIdx) : entityId;
    ts = dashIdx > 0 ? entityId.substring(dashIdx + 1) : '';
  }

  const entityUri = `@drift//slack_message/${channelId}/${ts}`;

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data, loading, error, refetch: refetchMessage } = useEntityQuery(GET_SLACK_MESSAGE, {
    variables: { channelId, ts },
    skip: !channelId || !ts,
  });

  const message = data?.slackMessage;
  const threadTs = message?.threadTs ?? message?.ts;

  const { data: threadData, refetch: refetchThread } = useEntityQuery(GET_SLACK_THREAD, {
    variables: { channelId, threadTs },
    skip: !channelId || !threadTs || !message?.replyCount,
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const [sendReply] = useEntityMutation(SEND_REPLY);
  const [addReaction] = useEntityMutation(ADD_REACTION);
  const [editMessage] = useEntityMutation(EDIT_MESSAGE);
  const [deleteMessage] = useEntityMutation(DELETE_MESSAGE);
  const [markRead] = useEntityMutation(MARK_READ);

  // ── Workstream linking (via SDK hook) ──────────────────────────────────
  const workstreamLinker = useWorkstreamLinker(entityUri, 'slack_message');

  // ── Auto mark-as-read on open ────────────────────────────────────────────
  const markedReadRef = useRef(false);
  useEffect(() => {
    if (markedReadRef.current || !message?.ts || !channelId) return;
    markedReadRef.current = true;
    markRead({ variables: { channelId, ts: message.ts } })
      .catch((err: any) => logger.error('Auto mark-as-read failed', { error: err?.message }));
  }, [message]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleReply = async (text: string) => {
    try {
      await sendReply({ variables: { channelId, text, threadTs: message?.threadTs ?? ts } });
      refetchThread();
      refetchMessage();
    } catch (err: any) {
      logger.error('Failed to send reply', { error: err?.message });
    }
  };

  const handleAddReaction = async (emoji: string) => {
    try {
      await addReaction({ variables: { channelId, ts, emoji } });
      refetchMessage();
    } catch (err: any) {
      logger.error('Failed to add reaction', { error: err?.message });
    }
  };

  const handleEditMessage = async (text: string) => {
    try {
      await editMessage({ variables: { channelId, ts, text } });
      refetchMessage();
    } catch (err: any) {
      logger.error('Failed to edit message', { error: err?.message });
    }
  };

  const handleDeleteMessage = async () => {
    try {
      await deleteMessage({ variables: { channelId, ts } });
      drawer.pop();
    } catch (err: any) {
      logger.error('Failed to delete message', { error: err?.message });
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading && !message) {
    return (
      <>
        <DrawerHeaderTitle>{label ?? 'Message'}</DrawerHeaderTitle>
        <DrawerBody className="text-muted-foreground text-[13px]">
          Loading message...
        </DrawerBody>
      </>
    );
  }

  if (error && !message) {
    return (
      <>
        <DrawerHeaderTitle>{label ?? 'Message'}</DrawerHeaderTitle>
        <DrawerBody className="text-muted-foreground text-[13px]">
          Failed to load message: {error.message}
        </DrawerBody>
      </>
    );
  }

  if (!message) {
    return (
      <DrawerBody className="text-muted-foreground text-[13px]">
        Message not found
      </DrawerBody>
    );
  }

  return (
    <MessageDrawerContent
      message={message}
      threadMessages={threadData?.slackThread?.messages}
      onReply={handleReply}
      onAddReaction={handleAddReaction}
      onEditMessage={handleEditMessage}
      onDeleteMessage={handleDeleteMessage}
      entityUri={entityUri}
      linkedWorkstreams={workstreamLinker.linkedWorkstreams}
      activeWorkstreams={workstreamLinker.activeWorkstreams}
      onLinkWorkstream={workstreamLinker.linkWorkstream}
      onUnlinkWorkstream={workstreamLinker.unlinkWorkstream}
      onStartWorkstream={(_id, title) => workstreamLinker.startWorkstream(title)}
    />
  );
}
