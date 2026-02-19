/**
 * gmail_message entity — Gmail API integration with actions.
 *
 * Uses the `gmail` integration for auth and the GmailClient.
 * Actions: compose, reply, forward, archive, unarchive,
 * star, unstar, mark_read, mark_unread, trash, modify_labels.
 *
 * NOTE: Types and helpers are inlined here because the ModuleEvaluator
 * sandbox does not allow cross-file requires. Only `@drift/entity-sdk`
 * and `zod` are available at runtime.
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';

// ---------- Gmail API response types (inlined) ----------

interface GmailApiHeader {
  name: string;
  value: string;
}

interface GmailApiBody {
  data?: string;
  size?: number;
  attachmentId?: string;
}

interface GmailApiPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailApiHeader[];
  body?: GmailApiBody;
  parts?: GmailApiPart[];
}

interface GmailApiPayload {
  mimeType?: string;
  headers?: GmailApiHeader[];
  body?: GmailApiBody;
  parts?: GmailApiPart[];
}

interface GmailApiRawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailApiPayload;
}

// ---------- GmailClient interface (matches class in integrations/gmail.ts) ----------
// This is a local interface, NOT a runtime import. The actual class is injected
// by the integration framework at runtime.

interface GmailClient {
  listMessages(params?: {
    q?: string;
    maxResults?: number;
    labelIds?: string[];
    pageToken?: string;
  }): Promise<{ messages: Array<{ id: string; threadId: string }>; nextPageToken?: string; resultSizeEstimate?: number }>;
  getMessage(id: string, format?: 'full' | 'metadata' | 'minimal'): Promise<GmailApiRawMessage>;
  getThread(id: string): Promise<{ id: string; snippet?: string; messages: GmailApiRawMessage[] }>;
  modifyMessage(id: string, addLabelIds?: string[], removeLabelIds?: string[]): Promise<GmailApiRawMessage>;
  trashMessage(id: string): Promise<GmailApiRawMessage>;
  untrashMessage(id: string): Promise<GmailApiRawMessage>;
  sendMessage(raw: string, threadId?: string): Promise<{ id: string; threadId: string }>;
  listLabels(): Promise<Array<{ id: string; name: string; type: string; messagesTotal?: number; messagesUnread?: number }>>;
  getProfile(): Promise<{ emailAddress: string; messagesTotal: number; threadsTotal: number }>;
}

// ---------- Extended resolver context with integration client ----------

interface GmailResolverContext extends EntityResolverContext {
  integrations?: {
    gmail?: {
      client: GmailClient | null;
    };
  };
}

// ---------- Inlined MIME helpers ----------

function extractHeaders(headers?: GmailApiHeader[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  for (const h of headers) {
    result[h.name.toLowerCase()] = h.value;
  }
  return result;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBody(payload?: GmailApiPayload): { text: string; html?: string } {
  if (!payload) return { text: '' };

  if (payload.body?.data) {
    const decoded = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    if (payload.mimeType === 'text/html') {
      return { text: htmlToText(decoded), html: decoded };
    }
    return { text: decoded };
  }

  if (payload.parts) {
    let text = '';
    let html: string | undefined;

    const walk = (parts: GmailApiPart[]) => {
      for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          text = Buffer.from(part.body.data, 'base64').toString('utf-8');
        } else if (part.mimeType === 'text/html' && part.body?.data) {
          html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        } else if (part.mimeType?.startsWith('multipart/') && part.parts) {
          walk(part.parts);
        }
      }
    };
    walk(payload.parts);

    if (!text && html) {
      text = htmlToText(html);
    }
    return { text, html };
  }

  return { text: '' };
}

function checkHasAttachments(payload?: GmailApiPayload): boolean {
  if (!payload?.parts) return false;
  return payload.parts.some(
    (part) => part.filename && part.filename.length > 0 && part.body?.attachmentId,
  );
}

function buildRfc2822Message(params: {
  to: string;
  from?: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];
  if (params.from) lines.push(`From: ${params.from}`);
  lines.push(`To: ${params.to}`);
  if (params.cc) lines.push(`Cc: ${params.cc}`);
  if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
  lines.push(`Subject: ${params.subject}`);
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) lines.push(`References: ${params.references}`);
  else if (params.inReplyTo) lines.push(`References: ${params.inReplyTo}`);
  lines.push('Content-Type: text/plain; charset=utf-8');
  lines.push('');
  lines.push(params.body);

  const raw = lines.join('\r\n');
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------- Schema ----------

const gmailMessageSchema = z.object({
  id: z.string(),
  type: z.literal('gmail_message'),
  uri: z.string(),
  title: z.string(),
  threadId: z.string(),
  snippet: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cc: z.string().optional(),
  date: z.string().optional(),
  messageId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  labelNames: z.string().optional(),
  isUnread: z.boolean().optional(),
  isStarred: z.boolean().optional(),
  isInbox: z.boolean().optional(),
  isDraft: z.boolean().optional(),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  hasAttachments: z.boolean().optional(),
  url: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

type GmailMessage = z.infer<typeof gmailMessageSchema>;

// ---------- Helpers ----------

function getClient(ctx: GmailResolverContext): GmailClient | null {
  return ctx.integrations?.gmail?.client ?? null;
}

function messageToEntity(
  msg: GmailApiRawMessage,
  labels?: Array<{ id: string; name: string }>,
): GmailMessage {
  const headers = extractHeaders(msg.payload?.headers);
  const { text, html } = extractBody(msg.payload);
  const labelIds = msg.labelIds ?? [];

  let labelNames: string | undefined;
  if (labels && labelIds.length) {
    const labelMap = new Map(labels.map((l) => [l.id, l.name]));
    const names = labelIds.map((id) => labelMap.get(id)).filter(Boolean);
    if (names.length) labelNames = names.join(', ');
  }

  const subject = headers.subject || msg.snippet?.slice(0, 80) || '(No subject)';

  return {
    id: msg.id,
    type: 'gmail_message',
    uri: `@drift//gmail_message/${msg.id}`,
    title: subject,
    threadId: msg.threadId,
    snippet: msg.snippet ?? undefined,
    from: headers.from ?? undefined,
    to: headers.to ?? undefined,
    cc: headers.cc ?? undefined,
    date: headers.date ?? undefined,
    messageId: headers['message-id'] ?? undefined,
    labelIds,
    labelNames,
    isUnread: labelIds.includes('UNREAD'),
    isStarred: labelIds.includes('STARRED'),
    isInbox: labelIds.includes('INBOX'),
    isDraft: labelIds.includes('DRAFT'),
    bodyText: text || undefined,
    bodyHtml: html ?? undefined,
    hasAttachments: checkHasAttachments(msg.payload),
    url: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
  };
}

// ---------- Action input schemas ----------

const composeInput = z.object({
  to: z.string().describe('Recipient email address'),
  subject: z.string().describe('Email subject'),
  body: z.string().describe('Email body text'),
  cc: z.string().optional().describe('CC email address'),
  bcc: z.string().optional().describe('BCC email address'),
});

const replyInput = z.object({
  body: z.string().describe('Reply body text'),
  replyAll: z.boolean().optional().describe('Whether to reply to all recipients'),
});

const forwardInput = z.object({
  to: z.string().describe('Recipient to forward to'),
  body: z.string().optional().describe('Optional text to prepend'),
});

const modifyLabelsActionInput = z.object({
  addLabelIds: z.array(z.string()).optional().describe('Label IDs to add'),
  removeLabelIds: z.array(z.string()).optional().describe('Label IDs to remove'),
});

// ---------- Entity definition ----------

const GmailMessageEntity = defineEntity({
  type: 'gmail_message',
  displayName: 'Gmail Message',
  description: 'An email message from Gmail',
  icon: 'mail',

  schema: gmailMessageSchema,

  uriPath: {
    segments: ['id'] as const,
    parse: (segments: string[]) => ({ id: segments[0] }),
    format: ({ id }: { id: string }) => id,
  },

  display: {
    emoji: '\u{2709}\u{FE0F}',
    colors: {
      bg: '#EA4335',
      text: '#FFFFFF',
      border: '#D93025',
    },
    description: 'Gmail email messages',
    filterDescriptions: [
      { name: 'labelId', type: 'string', description: 'Filter by Gmail label ID (e.g. INBOX, STARRED, SENT)' },
      { name: 'isUnread', type: 'boolean', description: 'Filter by read/unread status' },
      { name: 'isStarred', type: 'boolean', description: 'Filter by starred status' },
    ],
    outputFields: [
      { key: 'from', label: 'From', metadataPath: 'from', format: 'string' },
      { key: 'to', label: 'To', metadataPath: 'to', format: 'string' },
      { key: 'date', label: 'Date', metadataPath: 'date', format: 'string' },
      { key: 'labels', label: 'Labels', metadataPath: 'labelNames', format: 'string' },
      { key: 'url', label: 'URL', metadataPath: 'url', format: 'string' },
    ],
  },

  integrations: { gmail: 'gmail' },

  cache: {
    ttl: 60_000,
    maxSize: 200,
  },

  actions: [
    {
      id: 'compose',
      label: 'Compose Email',
      description: 'Compose and send a new email',
      icon: 'edit',
      scope: 'type',
      aiHint: 'Use when the user wants to compose and send a new email.',
      inputSchema: composeInput,
      handler: async (params: EntityActionParams<GmailMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx as GmailResolverContext);
        if (!client) return { success: false, message: 'No Gmail client configured' };

        const input = params.input as z.infer<typeof composeInput>;
        ctx.logger.info('Composing Gmail message', { to: input.to, subject: input.subject });

        const raw = buildRfc2822Message(input);
        const result = await client.sendMessage(raw);
        return {
          success: true,
          message: `Email sent to ${input.to}`,
          data: { messageId: result.id },
        };
      },
    },
    {
      id: 'reply',
      label: 'Reply',
      description: 'Reply to this email',
      icon: 'reply',
      scope: 'instance',
      aiHint: 'Use when the user wants to reply to an email.',
      inputSchema: replyInput,
      handler: async (params: EntityActionParams<GmailMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx as GmailResolverContext);
        if (!client) return { success: false, message: 'No Gmail client configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof replyInput>;
        const entity = params.entity;
        ctx.logger.info('Replying to Gmail message', { messageId: entity.id });

        const original = await client.getMessage(entity.id, 'metadata');
        const headers = extractHeaders(original.payload?.headers);
        const to = input.replyAll
          ? [headers.from, headers.to, headers.cc].filter(Boolean).join(', ')
          : headers.from ?? '';
        const subject = headers.subject?.startsWith('Re:') ? headers.subject : `Re: ${headers.subject ?? ''}`;

        const raw = buildRfc2822Message({
          to,
          subject,
          body: input.body,
          inReplyTo: headers['message-id'],
        });

        const result = await client.sendMessage(raw, original.threadId);
        return {
          success: true,
          message: 'Reply sent',
          data: { messageId: result.id },
        };
      },
    },
    {
      id: 'forward',
      label: 'Forward',
      description: 'Forward this email to a recipient',
      icon: 'forward',
      scope: 'instance',
      aiHint: 'Use when the user wants to forward an email.',
      inputSchema: forwardInput,
      handler: async (params: EntityActionParams<GmailMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx as GmailResolverContext);
        if (!client) return { success: false, message: 'No Gmail client configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof forwardInput>;
        const entity = params.entity;
        ctx.logger.info('Forwarding Gmail message', { messageId: entity.id, to: input.to });

        const original = await client.getMessage(entity.id, 'full');
        const headers = extractHeaders(original.payload?.headers);
        const { text: originalBody } = extractBody(original.payload);
        const subject = headers.subject?.startsWith('Fwd:') ? headers.subject : `Fwd: ${headers.subject ?? ''}`;

        const forwardBody = [
          input.body ?? '',
          '',
          '---------- Forwarded message ----------',
          `From: ${headers.from ?? ''}`,
          `Date: ${headers.date ?? ''}`,
          `Subject: ${headers.subject ?? ''}`,
          `To: ${headers.to ?? ''}`,
          '',
          originalBody,
        ].join('\n');

        const raw = buildRfc2822Message({ to: input.to, subject, body: forwardBody });
        const result = await client.sendMessage(raw);
        return {
          success: true,
          message: `Email forwarded to ${input.to}`,
          data: { messageId: result.id },
        };
      },
    },
    {
      id: 'archive',
      label: 'Archive',
      description: 'Archive this email (remove from INBOX)',
      icon: 'archive',
      scope: 'instance',
      aiHint: 'Use when the user wants to archive a message.',
      handler: async (params: EntityActionParams<GmailMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx as GmailResolverContext);
        if (!client) return { success: false, message: 'No Gmail client configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        ctx.logger.info('Archiving Gmail message', { messageId: params.entity.id });
        await client.modifyMessage(params.entity.id, [], ['INBOX']);
        return { success: true, message: 'Message archived' };
      },
    },
    {
      id: 'unarchive',
      label: 'Move to Inbox',
      description: 'Move this email back to INBOX',
      icon: 'inbox',
      scope: 'instance',
      aiHint: 'Use when the user wants to unarchive a message.',
      handler: async (params: EntityActionParams<GmailMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx as GmailResolverContext);
        if (!client) return { success: false, message: 'No Gmail client configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        ctx.logger.info('Unarchiving Gmail message', { messageId: params.entity.id });
        await client.modifyMessage(params.entity.id, ['INBOX'], []);
        return { success: true, message: 'Message moved to inbox' };
      },
    },
    {
      id: 'star',
      label: 'Star',
      description: 'Star this email',
      icon: 'star',
      scope: 'instance',
      aiHint: 'Use when the user wants to star an email.',
      handler: async (params: EntityActionParams<GmailMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx as GmailResolverContext);
        if (!client) return { success: false, message: 'No Gmail client configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        await client.modifyMessage(params.entity.id, ['STARRED'], []);
        return { success: true, message: 'Message starred' };
      },
    },
    {
      id: 'unstar',
      label: 'Unstar',
      description: 'Unstar this email',
      icon: 'star-off',
      scope: 'instance',
      aiHint: 'Use when the user wants to remove the star from an email.',
      handler: async (params: EntityActionParams<GmailMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx as GmailResolverContext);
        if (!client) return { success: false, message: 'No Gmail client configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        await client.modifyMessage(params.entity.id, [], ['STARRED']);
        return { success: true, message: 'Message unstarred' };
      },
    },
    {
      id: 'mark_read',
      label: 'Mark Read',
      description: 'Mark this email as read',
      icon: 'eye',
      scope: 'instance',
      aiHint: 'Use when the user wants to mark a message as read.',
      handler: async (params: EntityActionParams<GmailMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx as GmailResolverContext);
        if (!client) return { success: false, message: 'No Gmail client configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        await client.modifyMessage(params.entity.id, [], ['UNREAD']);
        return { success: true, message: 'Message marked as read' };
      },
    },
    {
      id: 'mark_unread',
      label: 'Mark Unread',
      description: 'Mark this email as unread',
      icon: 'eye-off',
      scope: 'instance',
      aiHint: 'Use when the user wants to mark a message as unread.',
      handler: async (params: EntityActionParams<GmailMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx as GmailResolverContext);
        if (!client) return { success: false, message: 'No Gmail client configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        await client.modifyMessage(params.entity.id, ['UNREAD'], []);
        return { success: true, message: 'Message marked as unread' };
      },
    },
    {
      id: 'trash',
      label: 'Trash',
      description: 'Move this email to trash',
      icon: 'trash',
      scope: 'instance',
      aiHint: 'Use when the user wants to delete/trash a message.',
      handler: async (params: EntityActionParams<GmailMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx as GmailResolverContext);
        if (!client) return { success: false, message: 'No Gmail client configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        ctx.logger.info('Trashing Gmail message', { messageId: params.entity.id });
        await client.trashMessage(params.entity.id);
        return { success: true, message: 'Message moved to trash' };
      },
    },
    {
      id: 'modify_labels',
      label: 'Modify Labels',
      description: 'Add or remove labels from this email',
      icon: 'tag',
      scope: 'instance',
      aiHint: 'Use when the user wants to change labels on a message. Call list_labels first to find valid IDs.',
      inputSchema: modifyLabelsActionInput,
      handler: async (params: EntityActionParams<GmailMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx as GmailResolverContext);
        if (!client) return { success: false, message: 'No Gmail client configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof modifyLabelsActionInput>;
        ctx.logger.info('Modifying Gmail message labels', { messageId: params.entity.id });
        await client.modifyMessage(params.entity.id, input.addLabelIds ?? [], input.removeLabelIds ?? []);
        return { success: true, message: 'Labels updated' };
      },
    },
  ],

  resolve: async ({ id }: { id: string }, ctx) => {
    const client = getClient(ctx as GmailResolverContext);
    if (!client) return null;

    ctx.logger.info('Resolving gmail message', { messageId: id });

    try {
      const msg = await client.getMessage(id, 'full');
      return messageToEntity(msg);
    } catch (err: unknown) {
      ctx.logger.error('Failed to resolve gmail message', {
        messageId: id,
        error: getErrorMessage(err),
      });
      return null;
    }
  },

  search: async (query: string, options, ctx) => {
    const client = getClient(ctx as GmailResolverContext);
    if (!client) return [];

    const limit = options?.limit ?? 10;
    ctx.logger.info('Searching gmail messages', { query, limit });

    try {
      const q = query && query !== '*' ? query : 'in:inbox';
      const result = await client.listMessages({ q, maxResults: limit });

      const entities = await Promise.all(
        result.messages.map(async (m) => {
          try {
            const msg = await client.getMessage(m.id, 'metadata');
            return messageToEntity(msg);
          } catch {
            return null;
          }
        }),
      );

      const filtered = entities.filter((e): e is GmailMessage => e !== null);
      ctx.logger.info('Gmail search returned results', { query, resultCount: filtered.length });
      return filtered;
    } catch (err: unknown) {
      ctx.logger.error('Failed to search gmail messages', {
        query,
        error: getErrorMessage(err),
      });
      return [];
    }
  },
});

export default GmailMessageEntity;
