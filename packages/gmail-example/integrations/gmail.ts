/**
 * Gmail Integration — OAuth auth + GmailClient + discovery methods.
 *
 * Owns the GmailClient lifecycle and exposes discovery/mutation operations.
 * Uses raw fetch against Gmail REST API v1 (no SDK).
 */

import { z } from 'zod';
import { defineIntegration } from '@drift/entity-sdk';

// ---------- Gmail API base ----------

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

// ---------- GmailClient ----------

interface GmailApiHeader { name: string; value: string }

interface GmailApiBody { data?: string; size?: number; attachmentId?: string }

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

export class GmailClient {
  constructor(private accessToken: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${GMAIL_API}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(error.error?.message || `Gmail API error: ${response.status}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) as T : {} as T;
  }

  async listMessages(params: {
    q?: string;
    maxResults?: number;
    labelIds?: string[];
    pageToken?: string;
  } = {}): Promise<{ messages: Array<{ id: string; threadId: string }>; nextPageToken?: string; resultSizeEstimate?: number }> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.maxResults) qs.set('maxResults', String(params.maxResults));
    if (params.labelIds?.length) {
      for (const id of params.labelIds) qs.append('labelIds', id);
    }
    if (params.pageToken) qs.set('pageToken', params.pageToken);

    const result = await this.request<{
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>(`/users/me/messages?${qs.toString()}`);

    return {
      messages: result.messages ?? [],
      nextPageToken: result.nextPageToken,
      resultSizeEstimate: result.resultSizeEstimate,
    };
  }

  async getMessage(id: string, format: 'full' | 'metadata' | 'minimal' = 'full'): Promise<GmailApiRawMessage> {
    const qs = new URLSearchParams({ format });
    if (format === 'metadata') {
      for (const h of ['Subject', 'From', 'To', 'Cc', 'Date', 'Message-ID']) {
        qs.append('metadataHeaders', h);
      }
    }
    return this.request<GmailApiRawMessage>(`/users/me/messages/${id}?${qs.toString()}`);
  }

  async getThread(id: string): Promise<{ id: string; snippet?: string; messages: GmailApiRawMessage[] }> {
    return this.request<{ id: string; snippet?: string; messages: GmailApiRawMessage[] }>(
      `/users/me/threads/${id}?format=full`
    );
  }

  async modifyMessage(id: string, addLabelIds?: string[], removeLabelIds?: string[]): Promise<GmailApiRawMessage> {
    return this.request<GmailApiRawMessage>(`/users/me/messages/${id}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: addLabelIds ?? [], removeLabelIds: removeLabelIds ?? [] }),
    });
  }

  async trashMessage(id: string): Promise<GmailApiRawMessage> {
    return this.request<GmailApiRawMessage>(`/users/me/messages/${id}/trash`, {
      method: 'POST',
      body: '{}',
    });
  }

  async untrashMessage(id: string): Promise<GmailApiRawMessage> {
    return this.request<GmailApiRawMessage>(`/users/me/messages/${id}/untrash`, {
      method: 'POST',
      body: '{}',
    });
  }

  async sendMessage(raw: string, threadId?: string): Promise<{ id: string; threadId: string }> {
    const body: Record<string, string> = { raw };
    if (threadId) body.threadId = threadId;
    return this.request<{ id: string; threadId: string }>('/users/me/messages/send', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async listLabels(): Promise<Array<{ id: string; name: string; type: string; messagesTotal?: number; messagesUnread?: number }>> {
    const result = await this.request<{
      labels: Array<{ id: string; name: string; type: string; messagesTotal?: number; messagesUnread?: number }>;
    }>('/users/me/labels');
    return result.labels ?? [];
  }

  async getProfile(): Promise<{ emailAddress: string; messagesTotal: number; threadsTotal: number }> {
    return this.request<{ emailAddress: string; messagesTotal: number; threadsTotal: number }>(
      '/users/me/profile'
    );
  }
}

// ---------- MIME helpers ----------

export function extractHeaders(headers?: GmailApiHeader[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  for (const h of headers) {
    result[h.name.toLowerCase()] = h.value;
  }
  return result;
}

export function extractBody(payload?: GmailApiPayload): { text: string; html?: string } {
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

export function hasAttachments(payload?: GmailApiPayload): boolean {
  if (!payload?.parts) return false;
  return payload.parts.some(
    (part) => part.filename && part.filename.length > 0 && part.body?.attachmentId,
  );
}

export function buildRfc2822Message(params: {
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

// ---------- Discovery input schemas ----------

const searchMessagesInput = z.object({
  query: z.string().describe('Gmail search query (e.g. "from:john@example.com", "is:unread", "subject:meeting")'),
  maxResults: z.number().int().min(1).max(50).optional().describe('Max results (default 10, max 50)'),
});

const sendMessageInput = z.object({
  to: z.string().describe('Recipient email address'),
  subject: z.string().describe('Email subject'),
  body: z.string().describe('Email body text'),
  cc: z.string().optional().describe('CC email address'),
  bcc: z.string().optional().describe('BCC email address'),
});

const replyToMessageInput = z.object({
  messageId: z.string().describe('The Gmail message ID to reply to'),
  body: z.string().describe('Reply body text'),
  replyAll: z.boolean().optional().describe('Whether to reply to all recipients'),
});

const forwardMessageInput = z.object({
  messageId: z.string().describe('The Gmail message ID to forward'),
  to: z.string().describe('Recipient email address'),
  body: z.string().optional().describe('Optional text to prepend before forwarded message'),
});

const messageIdInput = z.object({
  messageId: z.string().describe('The Gmail message ID'),
});

const modifyLabelsInput = z.object({
  messageId: z.string().describe('The Gmail message ID'),
  addLabelIds: z.array(z.string()).optional().describe('Label IDs to add'),
  removeLabelIds: z.array(z.string()).optional().describe('Label IDs to remove'),
});

// ---------- Integration definition ----------

export const gmailIntegration = defineIntegration<GmailClient>({
  id: 'gmail',
  displayName: 'Gmail',
  description: 'Gmail email API integration',
  icon: 'mail',

  secureKeys: [],

  oauth: {
    providers: [
      {
        providerId: 'google',
        displayName: 'Google',
        icon: 'mail',
        required: false,
        flow: {
          grantType: 'authorization_code',
          clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
          clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
          authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenUrl: 'https://oauth2.googleapis.com/token',
          scopes: [
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.compose',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ],
          scopeSeparator: ' ',
          redirectPort: 5763,
          redirectPath: '/callbacks/google',
          pkce: { enabled: true, method: 'S256' },
          extraAuthParams: { access_type: 'offline', prompt: 'consent' },
        },
        revocationUrl: 'https://oauth2.googleapis.com/revoke',
      },
    ],
  },

  createClient: async (ctx) => {
    if (ctx.oauth) {
      const oauthToken = await ctx.oauth.getAccessToken('google');
      if (oauthToken) {
        return new GmailClient(oauthToken);
      }
    }

    ctx.logger.warn('No OAuth token configured for Gmail');
    return null;
  },

  methods: [
    {
      id: 'list_labels',
      description: 'List all Gmail labels with message counts',
      aiHint: 'Use to discover available Gmail labels (folders). Returns label IDs, names, types (system/user), and message counts.',
      handler: async (client) => {
        const labels = await client.listLabels();
        return {
          labels: labels.map((l) => ({
            id: l.id,
            name: l.name,
            type: l.type,
            messagesTotal: l.messagesTotal,
            messagesUnread: l.messagesUnread,
          })),
        };
      },
    },
    {
      id: 'get_profile',
      description: 'Get Gmail user profile (email address, message/thread counts)',
      aiHint: 'Use to get the authenticated user email address and mailbox statistics.',
      handler: async (client) => {
        return await client.getProfile();
      },
    },
    {
      id: 'search_messages',
      description: 'Search Gmail messages with Gmail search syntax',
      aiHint: 'Use for full Gmail search (e.g. "from:john@example.com", "is:unread in:inbox", "subject:meeting after:2024/01/01"). Returns message IDs and metadata.',
      inputSchema: searchMessagesInput,
      handler: async (client, input) => {
        const { query, maxResults } = input as z.infer<typeof searchMessagesInput>;
        const result = await client.listMessages({ q: query, maxResults: maxResults ?? 10 });

        const messages = await Promise.all(
          result.messages.slice(0, maxResults ?? 10).map(async (m) => {
            const msg = await client.getMessage(m.id, 'metadata');
            const headers = extractHeaders(msg.payload?.headers);
            return {
              id: msg.id,
              threadId: msg.threadId,
              subject: headers.subject ?? '',
              from: headers.from ?? '',
              date: headers.date ?? '',
              snippet: msg.snippet ?? '',
              labelIds: msg.labelIds ?? [],
              isUnread: msg.labelIds?.includes('UNREAD') ?? false,
            };
          })
        );

        return { messages };
      },
    },
    {
      id: 'send_message',
      description: 'Compose and send a new email',
      aiHint: 'Use when the user wants to send a new email. Requires to, subject, and body. Optionally cc and bcc.',
      inputSchema: sendMessageInput,
      mutation: true,
      handler: async (client, input) => {
        const { to, subject, body, cc, bcc } = input as z.infer<typeof sendMessageInput>;
        const raw = buildRfc2822Message({ to, subject, body, cc, bcc });
        const result = await client.sendMessage(raw);
        return { success: true, message: `Email sent to ${to}`, messageId: result.id };
      },
    },
    {
      id: 'reply_to_message',
      description: 'Reply to a Gmail message',
      aiHint: 'Use when the user wants to reply to an email. Fetches the original message for threading headers, then sends a reply in the same thread.',
      inputSchema: replyToMessageInput,
      mutation: true,
      handler: async (client, input) => {
        const { messageId, body, replyAll } = input as z.infer<typeof replyToMessageInput>;
        const original = await client.getMessage(messageId, 'metadata');
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
        const result = await client.sendMessage(raw, original.threadId);
        return { success: true, message: `Reply sent`, messageId: result.id };
      },
    },
    {
      id: 'forward_message',
      description: 'Forward a Gmail message to a recipient',
      aiHint: 'Use when the user wants to forward an email. Fetches the original body and sends it to a new recipient.',
      inputSchema: forwardMessageInput,
      mutation: true,
      handler: async (client, input) => {
        const { messageId, to, body: extraBody } = input as z.infer<typeof forwardMessageInput>;
        const original = await client.getMessage(messageId, 'full');
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
        const result = await client.sendMessage(raw);
        return { success: true, message: `Email forwarded to ${to}`, messageId: result.id };
      },
    },
    {
      id: 'archive_message',
      description: 'Archive a Gmail message (remove from INBOX)',
      aiHint: 'Use when the user wants to archive an email. Removes the INBOX label.',
      inputSchema: messageIdInput,
      mutation: true,
      handler: async (client, input) => {
        const { messageId } = input as z.infer<typeof messageIdInput>;
        await client.modifyMessage(messageId, [], ['INBOX']);
        return { success: true, message: 'Message archived' };
      },
    },
    {
      id: 'unarchive_message',
      description: 'Unarchive a Gmail message (add back to INBOX)',
      aiHint: 'Use when the user wants to move a message back to the inbox.',
      inputSchema: messageIdInput,
      mutation: true,
      handler: async (client, input) => {
        const { messageId } = input as z.infer<typeof messageIdInput>;
        await client.modifyMessage(messageId, ['INBOX'], []);
        return { success: true, message: 'Message moved to inbox' };
      },
    },
    {
      id: 'star_message',
      description: 'Star a Gmail message',
      aiHint: 'Use when the user wants to star/favorite a message.',
      inputSchema: messageIdInput,
      mutation: true,
      handler: async (client, input) => {
        const { messageId } = input as z.infer<typeof messageIdInput>;
        await client.modifyMessage(messageId, ['STARRED'], []);
        return { success: true, message: 'Message starred' };
      },
    },
    {
      id: 'unstar_message',
      description: 'Unstar a Gmail message',
      aiHint: 'Use when the user wants to remove the star from a message.',
      inputSchema: messageIdInput,
      mutation: true,
      handler: async (client, input) => {
        const { messageId } = input as z.infer<typeof messageIdInput>;
        await client.modifyMessage(messageId, [], ['STARRED']);
        return { success: true, message: 'Message unstarred' };
      },
    },
    {
      id: 'mark_read',
      description: 'Mark a Gmail message as read',
      aiHint: 'Use when the user wants to mark a message as read.',
      inputSchema: messageIdInput,
      mutation: true,
      handler: async (client, input) => {
        const { messageId } = input as z.infer<typeof messageIdInput>;
        await client.modifyMessage(messageId, [], ['UNREAD']);
        return { success: true, message: 'Message marked as read' };
      },
    },
    {
      id: 'mark_unread',
      description: 'Mark a Gmail message as unread',
      aiHint: 'Use when the user wants to mark a message as unread.',
      inputSchema: messageIdInput,
      mutation: true,
      handler: async (client, input) => {
        const { messageId } = input as z.infer<typeof messageIdInput>;
        await client.modifyMessage(messageId, ['UNREAD'], []);
        return { success: true, message: 'Message marked as unread' };
      },
    },
    {
      id: 'trash_message',
      description: 'Move a Gmail message to trash',
      aiHint: 'Use when the user wants to delete/trash a message.',
      inputSchema: messageIdInput,
      mutation: true,
      handler: async (client, input) => {
        const { messageId } = input as z.infer<typeof messageIdInput>;
        await client.trashMessage(messageId);
        return { success: true, message: 'Message moved to trash' };
      },
    },
    {
      id: 'modify_labels',
      description: 'Add or remove labels on a Gmail message',
      aiHint: 'Use when the user wants to add or remove labels/folders from a message. Call list_labels first to find valid label IDs.',
      inputSchema: modifyLabelsInput,
      mutation: true,
      handler: async (client, input) => {
        const { messageId, addLabelIds, removeLabelIds } = input as z.infer<typeof modifyLabelsInput>;
        await client.modifyMessage(messageId, addLabelIds ?? [], removeLabelIds ?? []);
        return { success: true, message: 'Labels updated' };
      },
    },
  ],
});

export default gmailIntegration;
