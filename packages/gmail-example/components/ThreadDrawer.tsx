import { DrawerHeaderTitle } from '@drift/ui';
import { useEntityQuery, useEntityMutation, gql, logger, useWorkstreamLinker } from '@drift/plugin-api';
import ThreadDrawerContent from './ThreadDrawerContent';
import type { GmailMsg, GmailThreadMsg } from './ThreadDrawerContent';
import { useOptimistic } from './useOptimistic';

// ────────────────────────────────────────────────────────────────────────────
// GraphQL Queries
// ────────────────────────────────────────────────────────────────────────────

const GET_GMAIL_MESSAGE = gql`
  query GetGmailMessage($id: ID!) {
    gmailMessage(id: $id) {
      id
      title
      threadId
      snippet
      from
      to
      cc
      date
      messageId
      labelIds
      labelNames
      isUnread
      isStarred
      isInbox
      isDraft
      bodyText
      bodyHtml
      hasAttachments
      url
    }
  }
`;

const GET_GMAIL_THREAD = gql`
  query GetGmailThread($id: ID!) {
    gmailThread(id: $id) {
      id
      subject
      messageCount
      messages {
        id
        from
        to
        date
        snippet
        bodyText
        bodyHtml
        isUnread
      }
    }
  }
`;

const GET_GMAIL_LABELS = gql`
  query GetGmailLabels {
    gmailLabels {
      id
      name
      type
    }
  }
`;

// ────────────────────────────────────────────────────────────────────────────
// GraphQL Mutations
// ────────────────────────────────────────────────────────────────────────────

const ARCHIVE_MESSAGE = gql`
  mutation ArchiveGmailMessage($id: ID!) {
    archiveGmailMessage(id: $id) {
      success
      message
    }
  }
`;

const UNARCHIVE_MESSAGE = gql`
  mutation UnarchiveGmailMessage($id: ID!) {
    unarchiveGmailMessage(id: $id) {
      success
      message
    }
  }
`;

const STAR_MESSAGE = gql`
  mutation StarGmailMessage($id: ID!) {
    starGmailMessage(id: $id) {
      success
      message
    }
  }
`;

const UNSTAR_MESSAGE = gql`
  mutation UnstarGmailMessage($id: ID!) {
    unstarGmailMessage(id: $id) {
      success
      message
    }
  }
`;

const MARK_READ = gql`
  mutation MarkGmailMessageRead($id: ID!) {
    markGmailMessageRead(id: $id) {
      success
      message
    }
  }
`;

const MARK_UNREAD = gql`
  mutation MarkGmailMessageUnread($id: ID!) {
    markGmailMessageUnread(id: $id) {
      success
      message
    }
  }
`;

const TRASH_MESSAGE = gql`
  mutation TrashGmailMessage($id: ID!) {
    trashGmailMessage(id: $id) {
      success
      message
    }
  }
`;

const REPLY_MESSAGE = gql`
  mutation ReplyGmailMessage($id: ID!, $body: String!, $replyAll: Boolean) {
    replyGmailMessage(id: $id, body: $body, replyAll: $replyAll) {
      success
      message
    }
  }
`;

const MODIFY_LABELS = gql`
  mutation ModifyGmailLabels($id: ID!, $addLabelIds: [String!], $removeLabelIds: [String!]) {
    modifyGmailLabels(id: $id, addLabelIds: $addLabelIds, removeLabelIds: $removeLabelIds) {
      success
      message
    }
  }
`;

/** Build a canonical entity URI for a Gmail message */
function buildEntityUri(messageId: string): string {
  return `@drift//gmail_message/${messageId}`;
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

export default function ThreadDrawer({ entityId, label, drawer }: EntityDrawerProps) {
  // ── Queries ──────────────────────────────────────────────────────────────
  const { data, loading, error, refetch: refetchMessage } = useEntityQuery(GET_GMAIL_MESSAGE, {
    variables: { id: entityId },
  });

  const serverMessage: GmailMsg | undefined = data?.gmailMessage;
  const threadId = serverMessage?.threadId;

  const { data: threadData, refetch: refetchThread } = useEntityQuery(GET_GMAIL_THREAD, {
    variables: { id: threadId },
    skip: !threadId,
  });

  const { data: labelsData } = useEntityQuery(GET_GMAIL_LABELS);

  // ── Mutations ────────────────────────────────────────────────────────────
  const [archiveMessage] = useEntityMutation(ARCHIVE_MESSAGE);
  const [unarchiveMessage] = useEntityMutation(UNARCHIVE_MESSAGE);
  const [starMessage] = useEntityMutation(STAR_MESSAGE);
  const [unstarMessage] = useEntityMutation(UNSTAR_MESSAGE);
  const [markRead] = useEntityMutation(MARK_READ);
  const [markUnread] = useEntityMutation(MARK_UNREAD);
  const [trashMessage] = useEntityMutation(TRASH_MESSAGE);
  const [replyMessage] = useEntityMutation(REPLY_MESSAGE);
  const [modifyLabels] = useEntityMutation(MODIFY_LABELS);

  // ── Workstream linking ────────────────────────────────────────────────
  const entityUri = buildEntityUri(entityId);
  const workstreamLinker = useWorkstreamLinker(entityUri, 'gmail_message');

  // ── Optimistic state ────────────────────────────────────────────────────
  const optimistic = useOptimistic<GmailMsg>(serverMessage);
  const message = optimistic.data;

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleArchive = () => {
    const isInbox = message?.isInbox;
    optimistic.apply(
      { isInbox: !isInbox, labelIds: isInbox
        ? (message?.labelIds ?? []).filter((l) => l !== 'INBOX')
        : [...(message?.labelIds ?? []), 'INBOX'],
      },
      async () => {
        if (isInbox) {
          await archiveMessage({ variables: { id: entityId } });
        } else {
          await unarchiveMessage({ variables: { id: entityId } });
        }
        await refetchMessage();
      },
    );
  };

  const handleStar = () => {
    const isStarred = message?.isStarred;
    optimistic.apply(
      { isStarred: !isStarred },
      async () => {
        if (isStarred) {
          await unstarMessage({ variables: { id: entityId } });
        } else {
          await starMessage({ variables: { id: entityId } });
        }
        await refetchMessage();
      },
    );
  };

  const handleMarkRead = () => {
    const isUnread = message?.isUnread;
    optimistic.apply(
      { isUnread: !isUnread },
      async () => {
        if (isUnread) {
          await markRead({ variables: { id: entityId } });
        } else {
          await markUnread({ variables: { id: entityId } });
        }
        await refetchMessage();
      },
    );
  };

  const handleTrash = async () => {
    optimistic.apply({}, async () => {
      await trashMessage({ variables: { id: entityId } });
      drawer.close();
    });
  };

  const handleReply = async (body: string, replyAll?: boolean) => {
    try {
      await replyMessage({ variables: { id: entityId, body, replyAll } });
      refetchThread();
    } catch (err: unknown) {
      logger.error('Failed to reply', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleModifyLabels = (addLabelIds?: string[], removeLabelIds?: string[]) => {
    const currentLabels = message?.labelIds ?? [];
    const newLabels = currentLabels
      .filter((l) => !removeLabelIds?.includes(l))
      .concat(addLabelIds ?? []);
    optimistic.apply(
      { labelIds: newLabels },
      async () => {
        await modifyLabels({ variables: { id: entityId, addLabelIds, removeLabelIds } });
        await refetchMessage();
      },
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading && !serverMessage) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
          Loading message...
        </div>
      </div>
    );
  }

  if (error && !serverMessage) {
    logger.error('Failed to load Gmail message', { entityId, error: error.message });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
          Failed to load message: {error.message}
        </div>
      </div>
    );
  }

  if (!message) {
    return (
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
        Message not found
      </div>
    );
  }

  return (
    <ThreadDrawerContent
      message={message}
      thread={threadData?.gmailThread}
      labels={labelsData?.gmailLabels}
      onArchive={handleArchive}
      onStar={handleStar}
      onMarkRead={handleMarkRead}
      onTrash={handleTrash}
      onReply={handleReply}
      onModifyLabels={handleModifyLabels}
      error={optimistic.error}
      onDismissError={optimistic.dismissError}
      entityUri={entityUri}
      linkedWorkstreams={workstreamLinker.linkedWorkstreams}
      activeWorkstreams={workstreamLinker.activeWorkstreams}
      onLinkWorkstream={workstreamLinker.linkWorkstream}
      onUnlinkWorkstream={workstreamLinker.unlinkWorkstream}
      onStartWorkstream={(_id, title) => workstreamLinker.startWorkstream(title)}
    />
  );
}
