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

// Helper: get Gmail client from context
function getClient(ctx: any): any | null {
  return ctx.integrations?.gmail?.client ?? null;
}

// Helper: extract headers from Gmail API payload
function extractHeaders(headers?: Array<{ name: string; value: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  for (const h of headers) {
    result[h.name.toLowerCase()] = h.value;
  }
  return result;
}

// Helper: extract body from Gmail API payload
function extractBody(payload?: any): { text: string; html?: string } {
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

    const walk = (parts: any[]) => {
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

function hasAttachments(payload?: any): boolean {
  if (!payload?.parts) return false;
  return payload.parts.some(
    (part: any) => part.filename && part.filename.length > 0 && part.body?.attachmentId,
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

// Helper: convert raw Gmail API message to GQL response object
function messageToGql(msg: any): any {
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
    hasAttachments: hasAttachments(msg.payload),
    url: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
  };
}

// GraphQL Resolvers
export default {
  GmailMessage: {
    linkedContext: async (parent: any, _args: unknown, ctx: any) => {
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
      } catch (err: any) {
        ctx.logger.error('Failed to resolve linkedContext for GmailMessage', {
          messageId: parent.id,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },
  },

  Query: {
    gmailMessage: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return null;

      ctx.logger.info('Resolving gmail message via GraphQL', { messageId: id });

      try {
        const msg = await client.getMessage(id, 'full');
        return messageToGql(msg);
      } catch (err: any) {
        ctx.logger.error('Failed to resolve gmail message', {
          messageId: id,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },

    gmailMessages: async (
      _: unknown,
      { query, labelId, maxResults }: { query?: string; labelId?: string; maxResults?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) {
        ctx.logger.warn('gmailMessages: no Gmail client available');
        return [];
      }

      const limit = maxResults ?? 20;
      ctx.logger.info('Searching gmail messages via GraphQL', { query, labelId, limit });

      try {
        // Build Gmail search query
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

        // Fetch metadata for each message
        const messages = await Promise.all(
          result.messages.slice(0, limit).map(async (m: any) => {
            try {
              const msg = await client.getMessage(m.id, 'metadata');
              return messageToGql(msg);
            } catch {
              return null;
            }
          }),
        );

        return messages.filter(Boolean);
      } catch (err: any) {
        ctx.logger.error('Failed to search gmail messages', {
          query,
          labelId,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    gmailThread: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return null;

      ctx.logger.info('Resolving gmail thread via GraphQL', { threadId: id });

      try {
        const thread = await client.getThread(id);
        const messages = (thread.messages ?? []).map((msg: any) => {
          const headers = extractHeaders(msg.payload?.headers);
          const { text, html } = extractBody(msg.payload);
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
        });

        // Get subject from first message
        const firstMsg = thread.messages?.[0];
        const firstHeaders = extractHeaders(firstMsg?.payload?.headers);

        return {
          id: thread.id,
          subject: firstHeaders.subject ?? null,
          messages,
          messageCount: messages.length,
        };
      } catch (err: any) {
        ctx.logger.error('Failed to resolve gmail thread', {
          threadId: id,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },

    gmailLabels: async (_: unknown, __: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const labels = await client.listLabels();
        return labels.map((l: any) => ({
          id: l.id,
          name: l.name,
          type: l.type === 'system' ? 'system' : 'user',
          messagesTotal: l.messagesTotal ?? null,
          messagesUnread: l.messagesUnread ?? null,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to resolve gmail labels', {
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    gmailProfile: async (_: unknown, __: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return null;

      try {
        return await client.getProfile();
      } catch (err: any) {
        ctx.logger.error('Failed to resolve gmail profile', {
          error: err?.message ?? String(err),
        });
        return null;
      }
    },
  },

  Mutation: {
    sendGmailMessage: async (_: unknown, { input }: { input: any }, ctx: any) => {
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
        const result = await client.sendMessage(raw);
        return { success: true, message: `Email sent to ${input.to}` };
      } catch (err: any) {
        return { success: false, message: `Failed to send: ${err?.message ?? String(err)}` };
      }
    },

    replyGmailMessage: async (
      _: unknown,
      { id, body, replyAll }: { id: string; body: string; replyAll?: boolean },
      ctx: any,
    ) => {
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
      } catch (err: any) {
        return { success: false, message: `Failed to reply: ${err?.message ?? String(err)}` };
      }
    },

    forwardGmailMessage: async (
      _: unknown,
      { id, to, body: extraBody }: { id: string; to: string; body?: string },
      ctx: any,
    ) => {
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
      } catch (err: any) {
        return { success: false, message: `Failed to forward: ${err?.message ?? String(err)}` };
      }
    },

    archiveGmailMessage: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, [], ['INBOX']);
        return { success: true, message: 'Message archived' };
      } catch (err: any) {
        return { success: false, message: `Failed to archive: ${err?.message ?? String(err)}` };
      }
    },

    unarchiveGmailMessage: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, ['INBOX'], []);
        return { success: true, message: 'Message moved to inbox' };
      } catch (err: any) {
        return { success: false, message: `Failed to unarchive: ${err?.message ?? String(err)}` };
      }
    },

    trashGmailMessage: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.trashMessage(id);
        return { success: true, message: 'Message moved to trash' };
      } catch (err: any) {
        return { success: false, message: `Failed to trash: ${err?.message ?? String(err)}` };
      }
    },

    starGmailMessage: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, ['STARRED'], []);
        return { success: true, message: 'Message starred' };
      } catch (err: any) {
        return { success: false, message: `Failed to star: ${err?.message ?? String(err)}` };
      }
    },

    unstarGmailMessage: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, [], ['STARRED']);
        return { success: true, message: 'Message unstarred' };
      } catch (err: any) {
        return { success: false, message: `Failed to unstar: ${err?.message ?? String(err)}` };
      }
    },

    markGmailMessageRead: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, [], ['UNREAD']);
        return { success: true, message: 'Message marked as read' };
      } catch (err: any) {
        return { success: false, message: `Failed to mark as read: ${err?.message ?? String(err)}` };
      }
    },

    markGmailMessageUnread: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, ['UNREAD'], []);
        return { success: true, message: 'Message marked as unread' };
      } catch (err: any) {
        return { success: false, message: `Failed to mark as unread: ${err?.message ?? String(err)}` };
      }
    },

    modifyGmailLabels: async (
      _: unknown,
      { id, addLabelIds, removeLabelIds }: { id: string; addLabelIds?: string[]; removeLabelIds?: string[] },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Gmail client configured' };

      try {
        await client.modifyMessage(id, addLabelIds ?? [], removeLabelIds ?? []);
        return { success: true, message: 'Labels updated' };
      } catch (err: any) {
        return { success: false, message: `Failed to modify labels: ${err?.message ?? String(err)}` };
      }
    },
  },
};
