/**
 * Gmail GraphQL Resolvers
 *
 * Implements Query and Mutation resolvers for GmailMessage.
 * Uses the GmailClient via resolver context injection.
 *
 * Context shape (injected by EntitySchemaRegistry):
 *   ctx.integrations.gmail.client — GmailClient instance
 *   ctx.logger — scoped logger
 */

// ---------- Gmail API response types ----------

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

// ---------- GmailClient interface ----------

interface GmailClient {
  listMessages(params?: {
    q?: string;
    maxResults?: number;
    labelIds?: string[];
    pageToken?: string;
  }): Promise<{ messages: Array<{ id: string; threadId: string }>; nextPageToken?: string; resultSizeEstimate?: number }>;
  getMessage(id: string, format?: 'full' | 'metadata' | 'minimal'): Promise<GmailApiRawMessage>;
  getThread(id: string): Promise<{ id: string; snippet?: string; messages: GmailApiRawMessage[] }>;
  getAttachment(messageId: string, attachmentId: string): Promise<{ data: string; size: number }>;
  modifyMessage(id: string, addLabelIds?: string[], removeLabelIds?: string[]): Promise<GmailApiRawMessage>;
  trashMessage(id: string): Promise<GmailApiRawMessage>;
  untrashMessage(id: string): Promise<GmailApiRawMessage>;
  sendMessage(raw: string, threadId?: string): Promise<{ id: string; threadId: string }>;
  listLabels(): Promise<Array<{ id: string; name: string; type: string; messagesTotal?: number; messagesUnread?: number }>>;
  getProfile(): Promise<{ emailAddress: string; messagesTotal: number; threadsTotal: number }>;
}

// ---------- Resolver context type ----------

interface ResolverLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

interface GmailResolverContext {
  integrations?: {
    gmail?: {
      client: GmailClient | null;
    };
  };
  logger: ResolverLogger;
}

// ---------- GraphQL result types ----------

interface GmailAttachmentGql {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface GmailAttachmentDataGql {
  attachmentId: string;
  data: string;
}

interface GmailMessageGql {
  id: string;
  type: string;
  uri: string;
  title: string;
  threadId: string;
  snippet: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  date: string | null;
  messageId: string | null;
  labelIds: string[];
  labelNames: string | null;
  isUnread: boolean;
  isStarred: boolean;
  isInbox: boolean;
  isDraft: boolean;
  bodyText: string | null;
  bodyHtml: string | null;
  hasAttachments: boolean;
  attachments: GmailAttachmentGql[];
  url: string;
}

interface GmailThreadMessageGql {
  id: string;
  from: string | null;
  to: string | null;
  date: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  isUnread: boolean;
}

interface GmailThreadGql {
  id: string;
  subject: string | null;
  messages: GmailThreadMessageGql[];
  messageCount: number;
}

interface GmailLabelGql {
  id: string;
  name: string;
  type: string;
  messagesTotal: number | null;
  messagesUnread: number | null;
}

interface EntityActionResultGql {
  success: boolean;
  message: string;
}

interface SendGmailMessageInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}

// ---------- Helpers ----------

function getClient(ctx: GmailResolverContext): GmailClient | null {
  return ctx.integrations?.gmail?.client ?? null;
}

function extractHeaders(headers?: GmailApiHeader[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  for (const h of headers) {
    result[h.name.toLowerCase()] = h.value;
  }
  return result;
}

function getContentId(headers?: GmailApiHeader[]): string | undefined {
  if (!headers) return undefined;
  const cidHeader = headers.find((h) => h.name.toLowerCase() === 'content-id');
  if (!cidHeader?.value) return undefined;
  // Strip angle brackets: <image001@domain.com> → image001@domain.com
  return cidHeader.value.replace(/^<|>$/g, '');
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
    // CID → data URI map for inline images already embedded in the message body
    const cidMap: Record<string, string> = {};

    const walk = (parts: GmailApiPart[]) => {
      for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          text = Buffer.from(part.body.data, 'base64').toString('utf-8');
        } else if (part.mimeType === 'text/html' && part.body?.data) {
          html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        } else if (part.mimeType?.startsWith('multipart/') && part.parts) {
          walk(part.parts);
        } else if (part.mimeType?.startsWith('image/') && part.body?.data) {
          // Inline image with data already present — build CID mapping.
          // Gmail uses URL-safe base64; data URIs need standard base64.
          const cid = getContentId(part.headers);
          if (cid) {
            const standardB64 = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
            cidMap[cid] = `data:${part.mimeType};base64,${standardB64}`;
          }
        }
      }
    };
    walk(payload.parts);

    if (!text && html) {
      text = htmlToText(html);
    }

    // Replace cid: references in HTML with data URIs where available
    if (html && Object.keys(cidMap).length > 0) {
      html = html.replace(/src="cid:([^"]+)"/gi, (_match, cid) => {
        const dataUri = cidMap[cid as string];
        return dataUri ? `src="${dataUri}"` : `src="cid:${cid}"`;
      });
    }

    return { text, html };
  }

  return { text: '' };
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

function checkHasAttachments(payload?: GmailApiPayload): boolean {
  if (!payload) return false;
  const check = (parts?: GmailApiPart[]): boolean => {
    if (!parts) return false;
    return parts.some((part) => {
      if (part.filename && part.filename.length > 0 && part.body?.attachmentId) return true;
      return check(part.parts);
    });
  };
  return check(payload.parts);
}

function collectAttachmentParts(payload?: GmailApiPayload): GmailAttachmentGql[] {
  const result: GmailAttachmentGql[] = [];
  if (!payload) return result;
  const walk = (parts?: GmailApiPart[]) => {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
        result.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType ?? 'application/octet-stream',
          size: part.body.size ?? 0,
        });
      }
      if (part.parts) walk(part.parts);
    }
  };
  walk(payload.parts);
  return result;
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

/**
 * Fetch inline images that extractBody couldn't resolve because Gmail stored
 * them by attachmentId only (parts larger than the inline size threshold).
 * Returns the HTML with any remaining cid: references substituted.
 */
async function resolveRemoteInlineImages(
  html: string,
  payload: GmailApiPayload | undefined,
  messageId: string,
  client: GmailClient,
): Promise<string> {
  // Collect all still-unresolved cid: references
  const cidRefs = new Set<string>();
  const cidPattern = /src="cid:([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = cidPattern.exec(html)) !== null) {
    cidRefs.add(m[1]);
  }
  if (cidRefs.size === 0) return html;

  // Build cid → { attachmentId, mimeType } map from MIME parts
  const cidMeta: Record<string, { attachmentId: string; mimeType: string }> = {};
  const walkForCid = (parts?: GmailApiPart[]) => {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType?.startsWith('image/') && part.body?.attachmentId) {
        const cid = getContentId(part.headers);
        if (cid && cidRefs.has(cid)) {
          cidMeta[cid] = { attachmentId: part.body.attachmentId, mimeType: part.mimeType };
        }
      }
      if (part.parts) walkForCid(part.parts);
    }
  };
  walkForCid(payload?.parts);

  if (Object.keys(cidMeta).length === 0) return html;

  // Fetch each attachment and build data URIs
  const resolved: Record<string, string> = {};
  await Promise.all(
    Object.entries(cidMeta).map(async ([cid, { attachmentId, mimeType }]) => {
      try {
        const result = await client.getAttachment(messageId, attachmentId);
        const standardB64 = result.data.replace(/-/g, '+').replace(/_/g, '/');
        resolved[cid] = `data:${mimeType};base64,${standardB64}`;
      } catch {
        // Leave unresolvable — the sanitizer will drop it
      }
    }),
  );

  if (Object.keys(resolved).length === 0) return html;

  return html.replace(/src="cid:([^"]+)"/gi, (_match, cid) => {
    const dataUri = resolved[cid as string];
    return dataUri ? `src="${dataUri}"` : `src="cid:${cid}"`;
  });
}

function messageToGql(msg: GmailApiRawMessage): GmailMessageGql {
  const headers = extractHeaders(msg.payload?.headers);
  const { text, html } = extractBody(msg.payload);
  const labelIds = msg.labelIds ?? [];
  const subject = headers.subject || msg.snippet?.slice(0, 80) || '(No subject)';

  return {
    id: msg.id,
    type: 'gmail_message',
    uri: `@drift//gmail_message/${msg.id}`,
    title: subject,
    threadId: msg.threadId,
    snippet: msg.snippet ?? null,
    from: headers.from ?? null,
    to: headers.to ?? null,
    cc: headers.cc ?? null,
    date: headers.date ?? null,
    messageId: headers['message-id'] ?? null,
    labelIds,
    labelNames: labelIds.length ? labelIds.join(', ') : null,
    isUnread: labelIds.includes('UNREAD'),
    isStarred: labelIds.includes('STARRED'),
    isInbox: labelIds.includes('INBOX'),
    isDraft: labelIds.includes('DRAFT'),
    bodyText: text || null,
    bodyHtml: html ?? null,
    hasAttachments: checkHasAttachments(msg.payload),
    attachments: collectAttachmentParts(msg.payload),
    url: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
  };
}

// ---------- GraphQL Resolvers ----------

export default {
  GmailMessage: {
    linkedContext: async (parent: GmailMessageGql, _args: unknown, ctx: GmailResolverContext): Promise<string | null> => {
      const client = getClient(ctx);
      if (!client || !parent.id) return null;

      try {
        const msg = await client.getMessage(parent.id, 'full');
        const headers = extractHeaders(msg.payload?.headers);
        const { text } = extractBody(msg.payload);

        const lines = [
          `## Gmail: ${headers.subject || '(No subject)'}`,
          `- **From**: ${headers.from ?? 'Unknown'}`,
          `- **To**: ${headers.to ?? 'Unknown'}`,
          `- **Date**: ${headers.date ?? 'Unknown'}`,
        ];

        if (text) {
          const preview = text.length > 500 ? text.slice(0, 500) + '...' : text;
          lines.push('', '### Body', preview);
        }

        return lines.join('\n');
      } catch (err: unknown) {
        ctx.logger.error('Failed to resolve linkedContext for GmailMessage', {
          messageId: parent.id,
          error: getErrorMessage(err),
        });
        return null;
      }
    },
  },

  Query: {
    gmailMessage: async (_: unknown, { id }: { id: string }, ctx: GmailResolverContext): Promise<GmailMessageGql | null> => {
      const client = getClient(ctx);
      if (!client) return null;

      ctx.logger.info('Resolving gmail message via GraphQL', { messageId: id });

      try {
        const msg = await client.getMessage(id, 'full');
        const result = messageToGql(msg);
        // Resolve any large inline images (stored by attachmentId, no inline data)
        if (result.bodyHtml) {
          result.bodyHtml = await resolveRemoteInlineImages(result.bodyHtml, msg.payload, id, client);
        }
        return result;
      } catch (err: unknown) {
        ctx.logger.error('Failed to resolve gmail message', {
          messageId: id,
          error: getErrorMessage(err),
        });
        return null;
      }
    },

    gmailMessages: async (
      _: unknown,
      { query, labelId, maxResults }: { query?: string; labelId?: string; maxResults?: number },
      ctx: GmailResolverContext,
    ): Promise<GmailMessageGql[]> => {
      const client = getClient(ctx);
      if (!client) {
        ctx.logger.warn('gmailMessages: no Gmail client available');
        return [];
      }

      const limit = maxResults ?? 20;
      ctx.logger.info('Searching gmail messages via GraphQL', { query, labelId, limit });

      try {
        const parts: string[] = [];
        if (labelId) parts.push(`in:${labelId.toLowerCase()}`);
        if (query) parts.push(query);
        const q = parts.length > 0 ? parts.join(' ') : undefined;

        const result = await client.listMessages({
          q,
          maxResults: limit,
          labelIds: labelId ? [labelId] : undefined,
        });

        if (!result.messages.length) return [];

        const messages = await Promise.all(
          result.messages.slice(0, limit).map(async (m): Promise<GmailMessageGql | null> => {
            try {
              const msg = await client.getMessage(m.id, 'metadata');
              return messageToGql(msg);
            } catch {
              return null;
            }
          }),
        );

        return messages.filter((m): m is GmailMessageGql => m !== null);
      } catch (err: unknown) {
        ctx.logger.error('Failed to search gmail messages', {
          query,
          labelId,
          error: getErrorMessage(err),
        });
        return [];
      }
    },

    gmailThread: async (_: unknown, { id }: { id: string }, ctx: GmailResolverContext): Promise<GmailThreadGql | null> => {
      const client = getClient(ctx);
      if (!client) return null;

      ctx.logger.info('Resolving gmail thread via GraphQL', { threadId: id });

      try {
        const thread = await client.getThread(id);
        const messages: GmailThreadMessageGql[] = await Promise.all(
          (thread.messages ?? []).map(async (msg) => {
            const headers = extractHeaders(msg.payload?.headers);
            const { text, html: rawHtml } = extractBody(msg.payload);
            // Resolve large inline images that need separate fetching
            const html = rawHtml
              ? await resolveRemoteInlineImages(rawHtml, msg.payload, msg.id, client)
              : rawHtml;
            return {
              id: msg.id,
              from: headers.from ?? null,
              to: headers.to ?? null,
              date: headers.date ?? null,
              snippet: msg.snippet ?? null,
              bodyText: text || null,
              bodyHtml: html ?? null,
              isUnread: (msg.labelIds ?? []).includes('UNREAD'),
            };
          }),
        );

        const firstMsg = thread.messages?.[0];
        const firstHeaders = extractHeaders(firstMsg?.payload?.headers);

        return {
          id: thread.id,
          subject: firstHeaders.subject ?? null,
          messages,
          messageCount: messages.length,
        };
      } catch (err: unknown) {
        ctx.logger.error('Failed to resolve gmail thread', {
          threadId: id,
          error: getErrorMessage(err),
        });
        return null;
      }
    },

    gmailLabels: async (_: unknown, __: unknown, ctx: GmailResolverContext): Promise<GmailLabelGql[]> => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const labels = await client.listLabels();
        return labels.map((l): GmailLabelGql => ({
          id: l.id,
          name: l.name,
          type: l.type === 'system' ? 'system' : 'user',
          messagesTotal: l.messagesTotal ?? null,
          messagesUnread: l.messagesUnread ?? null,
        }));
      } catch (err: unknown) {
        ctx.logger.error('Failed to resolve gmail labels', {
          error: getErrorMessage(err),
        });
        return [];
      }
    },

    gmailProfile: async (_: unknown, __: unknown, ctx: GmailResolverContext) => {
      const client = getClient(ctx);
      if (!client) return null;

      try {
        return await client.getProfile();
      } catch (err: unknown) {
        ctx.logger.error('Failed to resolve gmail profile', {
          error: getErrorMessage(err),
        });
        return null;
      }
    },
  },

  Mutation: {
    sendGmailMessage: async (_: unknown, { input }: { input: SendGmailMessageInput }, ctx: GmailResolverContext): Promise<EntityActionResultGql> => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      ctx.logger.info('Sending Gmail message via GraphQL', { to: input.to, subject: input.subject });

      try {
        const raw = buildRfc2822Message({
          to: input.to,
          subject: input.subject,
          body: input.body,
          cc: input.cc,
          bcc: input.bcc,
        });
        await client.sendMessage(raw);
        return { success: true, message: `Email sent to ${input.to}` };
      } catch (err: unknown) {
        return { success: false, message: `Failed to send: ${getErrorMessage(err)}` };
      }
    },

    replyGmailMessage: async (
      _: unknown,
      { id, body, replyAll }: { id: string; body: string; replyAll?: boolean },
      ctx: GmailResolverContext,
    ): Promise<EntityActionResultGql> => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      ctx.logger.info('Replying to Gmail message via GraphQL', { messageId: id });

      try {
        const original = await client.getMessage(id, 'metadata');
        const headers = extractHeaders(original.payload?.headers);
        const to = replyAll
          ? [headers.from, headers.to, headers.cc].filter(Boolean).join(', ')
          : headers.from ?? '';
        const subject = headers.subject?.startsWith('Re:') ? headers.subject : `Re: ${headers.subject ?? ''}`;

        const raw = buildRfc2822Message({
          to,
          subject,
          body,
          inReplyTo: headers['message-id'],
        });
        await client.sendMessage(raw, original.threadId);
        return { success: true, message: 'Reply sent' };
      } catch (err: unknown) {
        return { success: false, message: `Failed to reply: ${getErrorMessage(err)}` };
      }
    },

    forwardGmailMessage: async (
      _: unknown,
      { id, to, body: extraBody }: { id: string; to: string; body?: string },
      ctx: GmailResolverContext,
    ): Promise<EntityActionResultGql> => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      ctx.logger.info('Forwarding Gmail message via GraphQL', { messageId: id, to });

      try {
        const original = await client.getMessage(id, 'full');
        const headers = extractHeaders(original.payload?.headers);
        const { text: originalBody } = extractBody(original.payload);
        const subject = headers.subject?.startsWith('Fwd:') ? headers.subject : `Fwd: ${headers.subject ?? ''}`;

        const forwardBody = [
          extraBody ?? '',
          '',
          '---------- Forwarded message ----------',
          `From: ${headers.from ?? ''}`,
          `Date: ${headers.date ?? ''}`,
          `Subject: ${headers.subject ?? ''}`,
          `To: ${headers.to ?? ''}`,
          '',
          originalBody,
        ].join('\n');

        const raw = buildRfc2822Message({ to, subject, body: forwardBody });
        await client.sendMessage(raw);
        return { success: true, message: `Email forwarded to ${to}` };
      } catch (err: unknown) {
        return { success: false, message: `Failed to forward: ${getErrorMessage(err)}` };
      }
    },

    archiveGmailMessage: async (_: unknown, { id }: { id: string }, ctx: GmailResolverContext): Promise<EntityActionResultGql> => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, [], ['INBOX']);
        return { success: true, message: 'Message archived' };
      } catch (err: unknown) {
        return { success: false, message: `Failed to archive: ${getErrorMessage(err)}` };
      }
    },

    unarchiveGmailMessage: async (_: unknown, { id }: { id: string }, ctx: GmailResolverContext): Promise<EntityActionResultGql> => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, ['INBOX'], []);
        return { success: true, message: 'Message moved to inbox' };
      } catch (err: unknown) {
        return { success: false, message: `Failed to unarchive: ${getErrorMessage(err)}` };
      }
    },

    trashGmailMessage: async (_: unknown, { id }: { id: string }, ctx: GmailResolverContext): Promise<EntityActionResultGql> => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.trashMessage(id);
        return { success: true, message: 'Message moved to trash' };
      } catch (err: unknown) {
        return { success: false, message: `Failed to trash: ${getErrorMessage(err)}` };
      }
    },

    starGmailMessage: async (_: unknown, { id }: { id: string }, ctx: GmailResolverContext): Promise<EntityActionResultGql> => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, ['STARRED'], []);
        return { success: true, message: 'Message starred' };
      } catch (err: unknown) {
        return { success: false, message: `Failed to star: ${getErrorMessage(err)}` };
      }
    },

    unstarGmailMessage: async (_: unknown, { id }: { id: string }, ctx: GmailResolverContext): Promise<EntityActionResultGql> => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, [], ['STARRED']);
        return { success: true, message: 'Message unstarred' };
      } catch (err: unknown) {
        return { success: false, message: `Failed to unstar: ${getErrorMessage(err)}` };
      }
    },

    markGmailMessageRead: async (_: unknown, { id }: { id: string }, ctx: GmailResolverContext): Promise<EntityActionResultGql> => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, [], ['UNREAD']);
        return { success: true, message: 'Message marked as read' };
      } catch (err: unknown) {
        return { success: false, message: `Failed to mark as read: ${getErrorMessage(err)}` };
      }
    },

    markGmailMessageUnread: async (_: unknown, { id }: { id: string }, ctx: GmailResolverContext): Promise<EntityActionResultGql> => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, ['UNREAD'], []);
        return { success: true, message: 'Message marked as unread' };
      } catch (err: unknown) {
        return { success: false, message: `Failed to mark as unread: ${getErrorMessage(err)}` };
      }
    },

    modifyGmailLabels: async (
      _: unknown,
      { id, addLabelIds, removeLabelIds }: { id: string; addLabelIds?: string[]; removeLabelIds?: string[] },
      ctx: GmailResolverContext,
    ): Promise<EntityActionResultGql> => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, addLabelIds ?? [], removeLabelIds ?? []);
        return { success: true, message: 'Labels updated' };
      } catch (err: unknown) {
        return { success: false, message: `Failed to modify labels: ${getErrorMessage(err)}` };
      }
    },

    fetchGmailAttachment: async (
      _: unknown,
      { messageId, attachmentId }: { messageId: string; attachmentId: string },
      ctx: GmailResolverContext,
    ): Promise<GmailAttachmentDataGql | null> => {
      const client = getClient(ctx);
      if (!client) return null;

      ctx.logger.info('Fetching Gmail attachment', { messageId, attachmentId });

      try {
        const result = await client.getAttachment(messageId, attachmentId);
        return { attachmentId, data: result.data };
      } catch (err: unknown) {
        ctx.logger.error('Failed to fetch attachment', {
          messageId,
          attachmentId,
          error: getErrorMessage(err),
        });
        return null;
      }
    },
  },
};
