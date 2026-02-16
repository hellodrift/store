import { useState } from 'react';
import {
  DrawerHeaderTitle,
  DrawerHeaderActions,
  DrawerBody,
  ContentSection,
  Button,
  Textarea,
  Separator,
  WorkstreamHeaderAction,
  WorkstreamSection,
  type LinkedWorkstream,
  type ActiveWorkstream,
} from '@drift/ui';
import { logger, openExternal } from '@drift/plugin-api';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface SlackMessageData {
  id: string;
  text: string;
  userId: string;
  userName?: string;
  userAvatar?: string;
  channelId: string;
  channelName?: string;
  ts: string;
  threadTs?: string;
  replyCount?: number;
  reactions?: { name: string; count: number }[];
  timestamp?: string;
  url?: string;
}

export interface MessageDrawerContentProps {
  message: SlackMessageData;
  threadMessages?: SlackMessageData[];
  onReply?: (text: string) => void;
  onAddReaction?: (emoji: string) => void;
  onEditMessage?: (text: string) => void;
  onDeleteMessage?: () => void;
  entityUri?: string;
  linkedWorkstreams?: LinkedWorkstream[];
  activeWorkstreams?: ActiveWorkstream[];
  onLinkWorkstream?: (workstreamId: string) => void;
  onUnlinkWorkstream?: (workstream: LinkedWorkstream) => void;
  onStartWorkstream?: (entityId: string, entityTitle: string) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  try {
    return new Date(parseFloat(ts) * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const QUICK_REACTIONS = [
  { emoji: 'thumbsup', display: '&#128077;' },
  { emoji: 'heart', display: '&#10084;&#65039;' },
  { emoji: 'eyes', display: '&#128064;' },
  { emoji: 'raised_hands', display: '&#128588;' },
  { emoji: 'white_check_mark', display: '&#9989;' },
];

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export default function MessageDrawerContent({
  message,
  threadMessages,
  onReply,
  onAddReaction,
  onEditMessage,
  onDeleteMessage,
  entityUri,
  linkedWorkstreams,
  activeWorkstreams,
  onLinkWorkstream,
  onUnlinkWorkstream,
  onStartWorkstream,
}: MessageDrawerContentProps) {
  const [replyDraft, setReplyDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');

  const handleSendReply = async () => {
    if (!replyDraft.trim() || !onReply) return;
    setSending(true);
    try {
      await onReply(replyDraft.trim());
      setReplyDraft('');
    } finally {
      setSending(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editDraft.trim() || !onEditMessage) return;
    await onEditMessage(editDraft.trim());
    setEditing(false);
  };

  // Filter thread to exclude the parent message itself
  const replies = (threadMessages ?? []).filter((m) => m.ts !== message.ts);
  const isThread = replies.length > 0 || (message.replyCount ?? 0) > 0;

  const messageTitle = isThread
    ? `Thread${message.channelName ? ` in #${message.channelName}` : ''}`
    : message.channelName
      ? `#${message.channelName}`
      : 'Message';

  return (
    <>
      {/* Header */}
      <DrawerHeaderTitle>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{messageTitle}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 400 }}>
            {formatTimestamp(message.ts)}
          </span>
        </span>
      </DrawerHeaderTitle>
      <DrawerHeaderActions>
        {activeWorkstreams && (
          <WorkstreamHeaderAction
            entityId={message.id}
            entityTitle={`Message from ${message.userName ?? message.userId}`}
            linkedWorkstreams={linkedWorkstreams}
            activeWorkstreams={activeWorkstreams}
            onStartWorkstream={onStartWorkstream}
            onAddToWorkstream={onLinkWorkstream}
          />
        )}
      </DrawerHeaderActions>

      {/* Body */}
      <DrawerBody className="flex flex-col gap-4">
        {/* Message */}
        <ContentSection title="Message">
          <div style={{ display: 'flex', gap: 10 }}>
            {/* Avatar */}
            {message.userAvatar ? (
              <img
                src={message.userAvatar}
                alt=""
                style={{ width: 32, height: 32, borderRadius: 6, flexShrink: 0 }}
              />
            ) : (
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: '#4A154B',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {(message.userName ?? message.userId)?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {message.userName ?? message.userId}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {formatTimestamp(message.ts)}
                </span>
              </div>
              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    className="min-h-[48px] text-xs resize-y"
                  />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button size="sm" onClick={handleSaveEdit} disabled={!editDraft.trim()}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {message.text}
                </div>
              )}
            </div>
          </div>

          {/* Reactions */}
          {message.reactions && message.reactions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
              {message.reactions.map((r) => (
                <span
                  key={r.name}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 6px',
                    borderRadius: 12,
                    border: '1px solid var(--border-muted)',
                    background: 'var(--surface-subtle)',
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                  onClick={() => onAddReaction?.(r.name)}
                >
                  :{r.name}: <span style={{ fontWeight: 600 }}>{r.count}</span>
                </span>
              ))}
            </div>
          )}

          {/* Quick reactions */}
          {onAddReaction && !editing && (
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              {QUICK_REACTIONS.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => onAddReaction(r.emoji)}
                  title={`:${r.emoji}:`}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-muted)',
                    borderRadius: 6,
                    padding: '2px 6px',
                    cursor: 'pointer',
                    fontSize: 14,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                  dangerouslySetInnerHTML={{ __html: r.display }}
                />
              ))}
            </div>
          )}

          {/* Actions */}
          {!editing && (
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              {onEditMessage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setEditDraft(message.text);
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
              )}
              {onDeleteMessage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-destructive"
                  onClick={onDeleteMessage}
                >
                  Delete
                </Button>
              )}
            </div>
          )}
        </ContentSection>

        {/* Thread */}
        {replies.length > 0 && (
          <ContentSection title={`Thread (${replies.length} ${replies.length === 1 ? 'reply' : 'replies'})`} collapsible defaultCollapsed={false}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {replies.map((reply) => (
                <div key={reply.ts} style={{ display: 'flex', gap: 8 }}>
                  {reply.userAvatar ? (
                    <img
                      src={reply.userAvatar}
                      alt=""
                      style={{ width: 20, height: 20, borderRadius: 4, flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        background: '#611f69',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 9,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {(reply.userName ?? reply.userId)?.[0]?.toUpperCase() ?? '?'}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {reply.userName ?? reply.userId}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {formatTimestamp(reply.ts)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                      {reply.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ContentSection>
        )}

        {/* Reply input */}
        {onReply && (
          <ContentSection title="Reply">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Textarea
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                placeholder="Write a reply..."
                className="min-h-[48px] text-xs resize-y"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSendReply();
                  }
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  size="sm"
                  onClick={handleSendReply}
                  disabled={!replyDraft.trim() || sending}
                >
                  {sending ? 'Sending...' : 'Reply'}
                </Button>
              </div>
            </div>
          </ContentSection>
        )}

        {/* Workstreams */}
        {activeWorkstreams && entityUri && (
          <WorkstreamSection
            workstreams={linkedWorkstreams ?? []}
            entityId={message.id}
            entityTitle={`Message from ${message.userName ?? message.userId}`}
            activeWorkstreams={activeWorkstreams}
            onRemove={onUnlinkWorkstream}
            onStartWorkstream={onStartWorkstream}
            onAddToWorkstream={onLinkWorkstream}
          />
        )}
      </DrawerBody>

      {/* Footer */}
      {message.url && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            display: 'flex',
            justifyContent: 'center',
            padding: 8,
            borderTop: '1px solid var(--border-muted)',
            background: 'var(--surface-page)',
          }}
        >
          <a
            href={message.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              openExternal(message.url!);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--text-muted)',
              textDecoration: 'none',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-accent, #4A154B)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            Open in Slack
          </a>
        </div>
      )}
    </>
  );
}
