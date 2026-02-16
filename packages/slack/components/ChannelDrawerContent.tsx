import { useState, useRef, useEffect } from 'react';
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

export interface SlackChannel {
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

export interface SlackMessageItem {
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
}

export interface SlackUser {
  id: string;
  name: string;
  displayName?: string;
  avatar?: string;
  isBot?: boolean;
}

export interface ChannelDrawerContentProps {
  channel: SlackChannel;
  messages: SlackMessageItem[];
  messagesLoading: boolean;
  users?: SlackUser[];
  onSendMessage?: (text: string) => void;
  onMarkRead?: () => void;
  onOpenThread?: (channelId: string, ts: string) => void;
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

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(parseFloat(ts) * 1000).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export default function ChannelDrawerContent({
  channel,
  messages,
  messagesLoading,
  users,
  onSendMessage,
  onMarkRead,
  onOpenThread,
  entityUri,
  linkedWorkstreams,
  activeWorkstreams,
  onLinkWorkstream,
  onUnlinkWorkstream,
  onStartWorkstream,
}: ChannelDrawerContentProps) {
  const [messageDraft, setMessageDraft] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    if (!messageDraft.trim() || !onSendMessage) return;
    setSending(true);
    try {
      await onSendMessage(messageDraft.trim());
      setMessageDraft('');
    } finally {
      setSending(false);
    }
  };

  const channelDisplayName = channel.isIm
    ? channel.name
    : channel.isPrivate
      ? `${channel.name}`
      : `#${channel.name}`;

  // Reverse messages so newest is at bottom
  const sortedMessages = [...messages].reverse();

  return (
    <>
      {/* Header */}
      <DrawerHeaderTitle>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>
            {channel.isIm ? '@' : channel.isPrivate ? '&#128274;' : '#'}
          </span>
          <span>{channel.name}</span>
          {channel.memberCount != null && (
            <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 400 }}>
              ({channel.memberCount} members)
            </span>
          )}
        </span>
      </DrawerHeaderTitle>
      <DrawerHeaderActions>
        {onMarkRead && (
          <Button variant="ghost" size="sm" onClick={onMarkRead}>
            Mark read
          </Button>
        )}
        {activeWorkstreams && (
          <WorkstreamHeaderAction
            entityId={channel.id}
            entityTitle={channelDisplayName}
            linkedWorkstreams={linkedWorkstreams}
            activeWorkstreams={activeWorkstreams}
            onStartWorkstream={onStartWorkstream}
            onAddToWorkstream={onLinkWorkstream}
          />
        )}
      </DrawerHeaderActions>

      {/* Body */}
      <DrawerBody className="flex flex-col gap-4">
        {/* Channel info */}
        {(channel.topic || channel.purpose) && (
          <ContentSection title="About">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {channel.topic && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Topic: </span>
                  {channel.topic}
                </div>
              )}
              {channel.purpose && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Purpose: </span>
                  {channel.purpose}
                </div>
              )}
            </div>
          </ContentSection>
        )}

        {/* Messages */}
        <ContentSection title="Messages">
          {messagesLoading && messages.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
              Loading messages...
            </div>
          ) : messages.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
              No messages yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
              {sortedMessages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                  }}
                >
                  {/* Avatar */}
                  {msg.userAvatar ? (
                    <img
                      src={msg.userAvatar}
                      alt=""
                      style={{ width: 24, height: 24, borderRadius: 4, flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        background: '#4A154B',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {(msg.userName ?? msg.userId)?.[0]?.toUpperCase() ?? '?'}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {msg.userName ?? msg.userId}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {formatTimestamp(msg.ts)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {msg.text}
                    </div>
                    {/* Thread indicator */}
                    {(msg.replyCount ?? 0) > 0 && onOpenThread && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenThread(msg.channelId, msg.ts);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          marginTop: 4,
                          padding: '2px 6px',
                          background: 'transparent',
                          border: '1px solid var(--border-default, rgba(255,255,255,0.1))',
                          borderRadius: 6,
                          color: 'var(--text-accent, #1264a3)',
                          fontSize: 11,
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'all 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--surface-elevated, rgba(255,255,255,0.06))';
                          e.currentTarget.style.color = 'var(--text-primary)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'var(--text-accent, #1264a3)';
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v6A1.5 1.5 0 0 1 13.5 10H7.333L4 13.5V10H2.5A1.5 1.5 0 0 1 1 8.5v-6zM2.5 2a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5H5v2.5L7.667 9H13.5a.5.5 0 0 0 .5-.5v-6a.5.5 0 0 0-.5-.5h-11z" />
                        </svg>
                        {msg.replyCount} {msg.replyCount === 1 ? 'reply' : 'replies'}
                      </button>
                    )}
                    {/* Reactions */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                        {msg.reactions.map((r) => (
                          <span
                            key={r.name}
                            style={{
                              fontSize: 10,
                              padding: '1px 4px',
                              borderRadius: 4,
                              background: 'var(--surface-subtle)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            :{r.name}: {r.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Compose */}
          {onSendMessage && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Textarea
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                placeholder={`Message ${channelDisplayName}...`}
                className="min-h-[48px] text-xs resize-y"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={!messageDraft.trim() || sending}
                >
                  {sending ? 'Sending...' : 'Send'}
                </Button>
              </div>
            </div>
          )}
        </ContentSection>

        {/* Workstreams */}
        {activeWorkstreams && entityUri && (
          <WorkstreamSection
            workstreams={linkedWorkstreams ?? []}
            entityId={channel.id}
            entityTitle={channelDisplayName}
            activeWorkstreams={activeWorkstreams}
            onRemove={onUnlinkWorkstream}
            onStartWorkstream={onStartWorkstream}
            onAddToWorkstream={onLinkWorkstream}
          />
        )}
      </DrawerBody>

      {/* Footer — Open in Slack */}
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
          href={`https://slack.com/app`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            openExternal('https://slack.com/app');
            logger.info('Opened Slack app', { channelId: channel.id });
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--text-muted)',
            textDecoration: 'none',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-accent, #4A154B)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
          </svg>
          Open in Slack
        </a>
      </div>
    </>
  );
}
