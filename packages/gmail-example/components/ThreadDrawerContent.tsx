import { useState, useEffect } from 'react';
import {
  DrawerHeaderTitle,
  DrawerHeaderActions,
  DrawerBody,
  ContentSection,
  Badge,
  Button,
  Textarea,
  Separator,
  WorkstreamHeaderAction,
  WorkstreamSection,
  ConfirmDialog,
  TrashIcon,
  type LinkedWorkstream,
  type ActiveWorkstream,
} from '@drift/ui';
import { logger, openExternal } from '@drift/plugin-api';
import EmailBody from './EmailBody';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface GmailAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailMsg {
  id: string;
  title: string;
  threadId: string;
  snippet?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  messageId?: string;
  labelIds?: string[];
  labelNames?: string;
  isUnread?: boolean;
  isStarred?: boolean;
  isInbox?: boolean;
  isDraft?: boolean;
  bodyText?: string;
  bodyHtml?: string;
  hasAttachments?: boolean;
  attachments?: GmailAttachment[];
  url?: string;
}

export interface GmailThreadMsg {
  id: string;
  from?: string;
  to?: string;
  date?: string;
  snippet?: string;
  bodyText?: string;
  bodyHtml?: string;
  isUnread?: boolean;
}

export interface GmailThread {
  id: string;
  subject?: string;
  messages: GmailThreadMsg[];
  messageCount: number;
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

export interface ThreadDrawerContentProps {
  message: GmailMsg;
  thread?: GmailThread;
  labels?: GmailLabel[];
  onArchive?: () => void;
  onStar?: () => void;
  onMarkRead?: () => void;
  onTrash?: () => void;
  onReply?: (body: string, replyAll?: boolean) => void;
  onModifyLabels?: (addLabelIds?: string[], removeLabelIds?: string[]) => void;
  onDownloadAttachment?: (attachmentId: string, filename: string, mimeType: string) => void;
  error?: string | null;
  onDismissError?: () => void;
  // Workstream linking
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

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
      <span style={{ width: 56, flexShrink: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-primary)' }}>{children}</div>
    </div>
  );
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function extractSenderName(from?: string): string {
  if (!from) return 'Unknown';
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return from;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('.sheet')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📊';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) return '📦';
  return '📎';
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export default function ThreadDrawerContent({
  message,
  thread,
  labels,
  onArchive,
  onStar,
  onMarkRead,
  onTrash,
  onReply,
  onModifyLabels,
  onDownloadAttachment,
  error,
  onDismissError,
  entityUri,
  linkedWorkstreams,
  activeWorkstreams,
  onLinkWorkstream,
  onUnlinkWorkstream,
  onStartWorkstream,
}: ThreadDrawerContentProps) {
  const [replyDraft, setReplyDraft] = useState('');
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll' | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());

  const threadMessages = thread?.messages ?? [];

  // Log email content for debugging rendering issues
  useEffect(() => {
    logger.info('[Gmail Debug] Drawer opened for message', {
      messageId: message.id,
      subject: message.title,
      hasBodyHtml: !!message.bodyHtml,
      hasBodyText: !!message.bodyText,
      bodyHtmlLength: message.bodyHtml?.length ?? 0,
      bodyTextLength: message.bodyText?.length ?? 0,
      bodyHtml: message.bodyHtml ?? null,
      bodyText: message.bodyText ?? null,
      snippet: message.snippet ?? null,
    });

    if (threadMessages.length > 0) {
      threadMessages.forEach((tmsg, idx) => {
        logger.info(`[Gmail Debug] Thread message ${idx + 1}/${threadMessages.length}`, {
          messageId: tmsg.id,
          from: tmsg.from,
          hasBodyHtml: !!tmsg.bodyHtml,
          hasBodyText: !!tmsg.bodyText,
          bodyHtmlLength: tmsg.bodyHtml?.length ?? 0,
          bodyTextLength: tmsg.bodyText?.length ?? 0,
          bodyHtml: tmsg.bodyHtml ?? null,
          bodyText: tmsg.bodyText ?? null,
          snippet: tmsg.snippet ?? null,
        });
      });
    }
  }, [message.id, message.title, message.bodyHtml, message.bodyText, message.snippet, threadMessages]);

  const handleOpenInGmail = () => {
    if (message.url) {
      openExternal(message.url);
      logger.info('Opened message in Gmail', { messageId: message.id });
    }
  };

  const handleSendReply = async () => {
    if (!replyDraft.trim() || !onReply) return;
    setSendingReply(true);
    try {
      await onReply(replyDraft.trim(), replyMode === 'replyAll');
      setReplyDraft('');
      setReplyMode(null);
    } finally {
      setSendingReply(false);
    }
  };

  const toggleExpanded = (msgId: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  };

  // Label badges
  const currentLabelIds = message.labelIds ?? [];
  const systemLabels = ['INBOX', 'UNREAD', 'STARRED', 'DRAFT', 'SENT', 'TRASH', 'SPAM', 'IMPORTANT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'];
  const displayLabels = currentLabelIds
    .filter((id) => !systemLabels.includes(id))
    .map((id) => {
      const label = labels?.find((l) => l.id === id);
      return label ? label.name : id;
    });

  return (
    <>
      {/* Header */}
      <DrawerHeaderTitle>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {message.isUnread && (
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--text-accent, #4285F4)',
              flexShrink: 0,
            }} />
          )}
          {message.isStarred && (
            <span style={{ color: '#F4B400', flexShrink: 0, fontSize: 14 }}>&#9733;</span>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1, fontSize: 13, fontWeight: 600 }}>
            {message.title}
          </span>
        </span>
      </DrawerHeaderTitle>
      <DrawerHeaderActions>
        {activeWorkstreams && (
          <WorkstreamHeaderAction
            entityId={message.id}
            entityTitle={message.title}
            linkedWorkstreams={linkedWorkstreams}
            activeWorkstreams={activeWorkstreams}
            onStartWorkstream={onStartWorkstream}
            onAddToWorkstream={onLinkWorkstream}
          />
        )}
      </DrawerHeaderActions>

      {/* Body */}
      <DrawerBody className="flex flex-col gap-4">

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 6,
              fontSize: 12,
              background: 'var(--status-error-bg, hsl(0 70% 95%))',
              color: 'var(--status-error, hsl(0 70% 40%))',
              border: '1px solid var(--status-error-border, hsl(0 60% 85%))',
            }}
          >
            <span style={{ flex: 1 }}>Update failed: {error}</span>
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  color: 'inherit',
                  fontSize: 14,
                  lineHeight: 1,
                  opacity: 0.7,
                }}
                aria-label="Dismiss error"
              >
                &times;
              </button>
            )}
          </div>
        )}

        {/* Quick actions */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {onArchive && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onArchive}>
              {message.isInbox ? 'Archive' : 'Move to Inbox'}
            </Button>
          )}
          {onStar && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onStar}>
              {message.isStarred ? 'Unstar' : 'Star'}
            </Button>
          )}
          {onMarkRead && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onMarkRead}>
              {message.isUnread ? 'Mark Read' : 'Mark Unread'}
            </Button>
          )}
        </div>

        {/* Properties */}
        <ContentSection title="Details">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <PropertyRow label="From">{message.from || '—'}</PropertyRow>
            <PropertyRow label="To">{message.to || '—'}</PropertyRow>
            {message.cc && <PropertyRow label="Cc">{message.cc}</PropertyRow>}
            <PropertyRow label="Date">{formatTime(message.date)}</PropertyRow>
            {displayLabels.length > 0 && (
              <PropertyRow label="Labels">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {displayLabels.map((name) => (
                    <Badge key={name} variant="secondary" className="text-xs">
                      {name}
                    </Badge>
                  ))}
                </div>
              </PropertyRow>
            )}
            {message.attachments && message.attachments.length > 0 && (
              <PropertyRow label="Attach">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {message.attachments.map((attachment) => (
                    <div
                      key={attachment.attachmentId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 6px',
                        borderRadius: 4,
                        background: 'var(--surface-subtle)',
                        border: '1px solid var(--border-muted)',
                      }}
                    >
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{getFileIcon(attachment.mimeType)}</span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 11,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: 'var(--text-primary)',
                        }}
                        title={attachment.filename}
                      >
                        {attachment.filename}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {formatFileSize(attachment.size)}
                      </span>
                      {onDownloadAttachment && (
                        <button
                          type="button"
                          onClick={() => onDownloadAttachment(attachment.attachmentId, attachment.filename, attachment.mimeType)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            borderRadius: 3,
                            color: 'var(--text-link, #1A73E8)',
                            fontSize: 10,
                            fontWeight: 500,
                            flexShrink: 0,
                          }}
                          title={`Download ${attachment.filename}`}
                        >
                          ↓
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </PropertyRow>
            )}
          </div>
        </ContentSection>

        {/* Thread messages */}
        <ContentSection
          title={`Thread${threadMessages.length > 1 ? ` (${threadMessages.length})` : ''}`}
          collapsible
          defaultCollapsed={false}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {threadMessages.length > 0 ? (
              threadMessages.map((tmsg, idx) => {
                const isLast = idx === threadMessages.length - 1;
                const isExpanded = isLast || expandedMessages.has(tmsg.id);

                return (
                  <div
                    key={tmsg.id}
                    style={{
                      borderRadius: 6,
                      border: '1px solid var(--border-muted)',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Message header — clickable to expand */}
                    <button
                      type="button"
                      onClick={() => toggleExpanded(tmsg.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        padding: '8px 12px',
                        border: 'none',
                        background: tmsg.isUnread ? 'var(--surface-subtle)' : 'transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: 12,
                      }}
                    >
                      {tmsg.isUnread && (
                        <span style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--text-accent, #4285F4)',
                          flexShrink: 0,
                        }} />
                      )}
                      <span style={{ fontWeight: tmsg.isUnread ? 600 : 400, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {extractSenderName(tmsg.from)}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
                        {formatTime(tmsg.date)}
                      </span>
                    </button>

                    {/* Expanded body */}
                    {isExpanded && (
                      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-muted)' }}>
                        <EmailBody
                          bodyHtml={tmsg.bodyHtml}
                          bodyText={tmsg.bodyText}
                          snippet={tmsg.snippet}
                        />
                      </div>
                    )}

                    {/* Collapsed snippet */}
                    {!isExpanded && tmsg.snippet && (
                      <div style={{ padding: '4px 12px 8px', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tmsg.snippet}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              // Fall back to main message body
              <EmailBody
                bodyHtml={message.bodyHtml}
                bodyText={message.bodyText}
                snippet={message.snippet}
              />
            )}
          </div>
        </ContentSection>

        {/* Reply section */}
        {onReply && (
          <ContentSection title="Reply">
            {replyMode === null ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setReplyMode('reply')}>
                  Reply
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setReplyMode('replyAll')}>
                  Reply All
                </Button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Textarea
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  placeholder={replyMode === 'replyAll' ? 'Reply to all...' : 'Write a reply...'}
                  className="min-h-[80px] text-xs resize-y"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSendReply();
                    }
                  }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Button variant="ghost" size="sm" onClick={() => { setReplyMode(null); setReplyDraft(''); }}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSendReply}
                    disabled={!replyDraft.trim() || sendingReply}
                  >
                    {sendingReply ? 'Sending...' : replyMode === 'replyAll' ? 'Reply All' : 'Reply'}
                  </Button>
                </div>
              </div>
            )}
          </ContentSection>
        )}

        {/* Workstreams */}
        {activeWorkstreams && entityUri && (
          <WorkstreamSection
            workstreams={linkedWorkstreams ?? []}
            entityId={message.id}
            entityTitle={message.title}
            activeWorkstreams={activeWorkstreams}
            onRemove={onUnlinkWorkstream}
            onStartWorkstream={onStartWorkstream}
            onAddToWorkstream={onLinkWorkstream}
          />
        )}

        <Separator />

      </DrawerBody>

      {/* Sticky footer */}
      {(message.url || onTrash) && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 8,
            borderTop: '1px solid var(--border-muted)',
            background: 'var(--surface-page)',
          }}
        >
          {message.url && (
            <a
              href={message.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                handleOpenInGmail();
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
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#EA4335';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              Open in Gmail
            </a>
          )}
          {onTrash && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive gap-1"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <TrashIcon size={12} />
                Trash
              </Button>
              <ConfirmDialog
                open={deleteConfirmOpen}
                onOpenChange={setDeleteConfirmOpen}
                title="Trash message"
                description={`Are you sure you want to trash "${message.title}"?`}
                confirmLabel="Trash"
                variant="destructive"
                onConfirm={() => {
                  setDeleteConfirmOpen(false);
                  onTrash();
                }}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
