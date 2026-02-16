/**
 * slack_message entity — Slack messages with thread support.
 *
 * Uses the `slack` integration for auth and API calls.
 * Actions: send_message, reply_in_thread, add_reaction, edit_message, delete_message.
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';
import type { WebClient } from '@slack/web-api';

// ---------- Schema ----------

const slackMessageSchema = z.object({
  id: z.string(),
  type: z.literal('slack_message'),
  uri: z.string(),
  text: z.string(),
  userId: z.string(),
  userName: z.string().optional(),
  userAvatar: z.string().optional(),
  channelId: z.string(),
  channelName: z.string().optional(),
  ts: z.string(),
  threadTs: z.string().optional(),
  replyCount: z.number().optional(),
  reactions: z.array(z.object({ name: z.string(), count: z.number() })).optional(),
  timestamp: z.string().optional(),
  url: z.string().optional(),
});

type SlackMessage = z.infer<typeof slackMessageSchema>;

// ---------- Helpers ----------

function getClient(ctx: EntityResolverContext): WebClient | null {
  return (ctx as any).integrations?.slack?.client ?? null;
}

// ---------- Action input schemas ----------

const sendMessageInput = z.object({
  channelId: z.string().describe('Channel ID to send message to. Call list_channels first.'),
  text: z.string().describe('Message text'),
});

const replyInThreadInput = z.object({
  text: z.string().describe('Reply text'),
});

const addReactionInput = z.object({
  emoji: z.string().describe('Emoji name without colons (e.g., "thumbsup")'),
});

const editMessageInput = z.object({
  text: z.string().describe('New message text'),
});

// ---------- Entity definition ----------

const SlackMessageEntity = defineEntity({
  type: 'slack_message',
  displayName: 'Slack Message',
  description: 'A message from Slack',
  icon: 'message-square',

  schema: slackMessageSchema,

  uriPath: {
    segments: ['channelId', 'ts'] as const,
    parse: (segments: string[]) => ({ channelId: segments[0], ts: segments[1] }),
    format: ({ channelId, ts }: { channelId: string; ts: string }) => `${channelId}/${ts}`,
  },

  display: {
    emoji: '\u{1F4AC}',
    colors: {
      bg: '#4A154B',
      text: '#FFFFFF',
      border: '#611f69',
    },
    description: 'Slack messages from channels and DMs',
    outputFields: [
      { key: 'channel', label: 'Channel', metadataPath: 'channelName', format: 'string' },
      { key: 'author', label: 'Author', metadataPath: 'userName', format: 'string' },
      { key: 'text', label: 'Message', metadataPath: 'text', format: 'string' },
    ],
  },

  integrations: { slack: 'slack' },

  cache: {
    ttl: 15_000,
    maxSize: 200,
  },

  actions: [
    {
      id: 'send_message',
      label: 'Send Message',
      description: 'Send a new Slack message',
      icon: 'message-square',
      scope: 'type',
      aiHint: 'Use when the user wants to send a Slack message. Call list_channels first to get channelId.',
      inputSchema: sendMessageInput,
      handler: async (params: EntityActionParams<SlackMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Slack token configured' };

        const input = params.input as z.infer<typeof sendMessageInput>;
        ctx.logger.info('Sending Slack message', { channelId: input.channelId });

        try {
          const result = await client.chat.postMessage({
            channel: input.channelId,
            text: input.text,
          });

          if (!result.ok) return { success: false, message: `Failed to send message: ${result.error}` };

          return {
            success: true,
            message: `Sent message to ${input.channelId}`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.logger.error('Failed to send Slack message', { channelId: input.channelId, error: errMsg });
          return { success: false, message: `Failed to send message: ${errMsg}` };
        }
      },
    },
    {
      id: 'reply_in_thread',
      label: 'Reply in Thread',
      description: 'Reply to this message in a thread',
      icon: 'message-circle',
      scope: 'instance',
      aiHint: 'Use to reply in the thread of the current message.',
      inputSchema: replyInThreadInput,
      handler: async (params: EntityActionParams<SlackMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Slack token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof replyInThreadInput>;
        const threadTs = params.entity.threadTs ?? params.entity.ts;

        ctx.logger.info('Replying in Slack thread', { channelId: params.entity.channelId, threadTs });

        const result = await client.chat.postMessage({
          channel: params.entity.channelId,
          text: input.text,
          thread_ts: threadTs,
        });

        if (!result.ok) return { success: false, message: 'Failed to reply in thread' };

        return {
          success: true,
          message: 'Replied in thread',
        };
      },
    },
    {
      id: 'add_reaction',
      label: 'Add Reaction',
      description: 'Add an emoji reaction to this message',
      icon: 'plus',
      scope: 'instance',
      aiHint: 'Use to add an emoji reaction. Emoji name without colons (e.g., "thumbsup").',
      inputSchema: addReactionInput,
      handler: async (params: EntityActionParams<SlackMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Slack token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof addReactionInput>;

        const result = await client.reactions.add({
          channel: params.entity.channelId,
          timestamp: params.entity.ts,
          name: input.emoji,
        });

        if (!result.ok) return { success: false, message: 'Failed to add reaction' };

        return {
          success: true,
          message: `Added :${input.emoji}: reaction`,
        };
      },
    },
    {
      id: 'edit_message',
      label: 'Edit Message',
      description: 'Edit this message',
      icon: 'edit',
      scope: 'instance',
      aiHint: 'Use to edit the text of this message. Only works for messages you sent.',
      inputSchema: editMessageInput,
      handler: async (params: EntityActionParams<SlackMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Slack token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof editMessageInput>;

        const result = await client.chat.update({
          channel: params.entity.channelId,
          ts: params.entity.ts,
          text: input.text,
        });

        if (!result.ok) return { success: false, message: 'Failed to edit message' };

        return {
          success: true,
          message: 'Message edited',
        };
      },
    },
    {
      id: 'delete_message',
      label: 'Delete Message',
      description: 'Delete this message',
      icon: 'trash',
      scope: 'instance',
      aiHint: 'Use to delete this message. Only works for messages you sent.',
      handler: async (params: EntityActionParams<SlackMessage>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Slack token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const result = await client.chat.delete({
          channel: params.entity.channelId,
          ts: params.entity.ts,
        });

        if (!result.ok) return { success: false, message: 'Failed to delete message' };

        return {
          success: true,
          message: 'Message deleted',
        };
      },
    },
  ],

  resolve: async ({ channelId, ts }: { channelId: string; ts: string }, ctx) => {
    const client = getClient(ctx);
    if (!client) return null;

    ctx.logger.info('Resolving slack message', { channelId, ts });

    try {
      const result = await client.conversations.history({
        channel: channelId,
        latest: ts,
        oldest: ts,
        inclusive: true,
        limit: 1,
      });

      const msg = result.messages?.[0];
      if (!msg) return null;

      // Resolve user info
      let userName: string | undefined;
      let userAvatar: string | undefined;
      if (msg.user) {
        try {
          const userResult = await client.users.info({ user: msg.user });
          const profile = (userResult.user as any)?.profile;
          userName = profile?.display_name || profile?.real_name || msg.user;
          userAvatar = profile?.image_48;
        } catch {
          // user resolution failed
        }
      }

      // Resolve channel name
      let channelName: string | undefined;
      try {
        const channelResult = await client.conversations.info({ channel: channelId });
        channelName = (channelResult.channel as any)?.name;
      } catch {
        // channel resolution failed
      }

      return {
        id: `${channelId}-${ts}`,
        type: 'slack_message' as const,
        uri: `@drift//slack_message/${channelId}/${ts}`,
        text: msg.text ?? '',
        userId: msg.user ?? '',
        userName,
        userAvatar,
        channelId,
        channelName,
        ts: msg.ts ?? ts,
        threadTs: msg.thread_ts ?? undefined,
        replyCount: msg.reply_count ?? undefined,
        reactions: (msg.reactions ?? []).map((r: any) => ({
          name: r.name ?? '',
          count: r.count ?? 0,
        })),
        timestamp: msg.ts
          ? new Date(parseFloat(msg.ts) * 1000).toISOString()
          : undefined,
      };
    } catch (err) {
      ctx.logger.error('Failed to resolve slack message', {
        channelId,
        ts,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  search: async (query: string, options, ctx) => {
    const client = getClient(ctx);
    if (!client) return [];

    const limit = options?.limit ?? 20;
    ctx.logger.info('Searching slack messages', { query, limit });

    try {
      const result = await client.search.messages({
        query,
        count: limit,
        sort: 'timestamp',
        sort_dir: 'desc',
      });

      return (result.messages?.matches ?? []).map((m: any) => ({
        id: `${m.channel?.id}-${m.ts}`,
        type: 'slack_message' as const,
        uri: `@drift//slack_message/${m.channel?.id}/${m.ts}`,
        text: m.text ?? '',
        userId: m.user ?? '',
        userName: m.username ?? undefined,
        channelId: m.channel?.id ?? '',
        channelName: m.channel?.name ?? undefined,
        ts: m.ts,
        threadTs: m.thread_ts ?? undefined,
        timestamp: m.ts
          ? new Date(parseFloat(m.ts) * 1000).toISOString()
          : undefined,
      }));
    } catch (err) {
      ctx.logger.error('Failed to search slack messages', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
});

export default SlackMessageEntity;
