/**
 * Slack Integration — Shared auth + client + discovery/mutation methods.
 *
 * Owns the WebClient lifecycle and exposes Slack API operations
 * that any Slack entity can call.
 */

import { z } from 'zod';
import { defineIntegration } from '@drift/entity-sdk';
import { WebClient } from '@slack/web-api';

// ---------- Input schemas ----------

const getChannelInfoInput = z.object({
  channelId: z.string().describe('Channel ID (e.g., C01234567)'),
});

const searchMessagesInput = z.object({
  query: z.string().describe('Search query string'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
});

const sendMessageInput = z.object({
  channelId: z.string().describe('Channel ID to send message to. Call list_channels first.'),
  text: z.string().describe('Message text (supports Slack mrkdwn)'),
  threadTs: z.string().optional().describe('Thread timestamp to reply to (for threaded replies)'),
});

const replyToThreadInput = z.object({
  channelId: z.string().describe('Channel ID containing the thread'),
  threadTs: z.string().describe('Parent message timestamp'),
  text: z.string().describe('Reply text'),
});

const addReactionInput = z.object({
  channelId: z.string().describe('Channel ID'),
  ts: z.string().describe('Message timestamp'),
  emoji: z.string().describe('Emoji name without colons (e.g., "thumbsup")'),
});

const editMessageInput = z.object({
  channelId: z.string().describe('Channel ID'),
  ts: z.string().describe('Message timestamp'),
  text: z.string().describe('New message text'),
});

const deleteMessageInput = z.object({
  channelId: z.string().describe('Channel ID'),
  ts: z.string().describe('Message timestamp'),
});

const markReadInput = z.object({
  channelId: z.string().describe('Channel ID'),
  ts: z.string().describe('Timestamp to mark as read up to'),
});

const listChannelsInput = z.object({
  types: z.string().optional().describe('Comma-separated channel types: public_channel, private_channel, im, mpim'),
  limit: z.number().int().min(1).max(200).optional().describe('Max results (default 100)'),
});

const listUsersInput = z.object({
  limit: z.number().int().min(1).max(200).optional().describe('Max results (default 100)'),
});

// ---------- Integration definition ----------

export const slackIntegration = defineIntegration<WebClient>({
  id: 'slack',
  displayName: 'Slack',
  description: 'Slack messaging API',
  icon: 'message-square',

  oauth: {
    providers: [{
      providerId: 'slack',
      displayName: 'Slack',
      icon: 'message-square',
      required: false,
      flow: {
        grantType: 'web_redirect',
        webAuthPath: '/api/integrations/slack/auth',
        scopes: ['channels:history', 'channels:read', 'chat:write',
                 'groups:history', 'groups:read', 'im:history', 'im:read',
                 'users:read', 'reactions:write', 'search:read'],
        clientId: process.env.SLACK_OAUTH_CLIENT_ID ?? '',
        clientSecret: process.env.SLACK_OAUTH_CLIENT_SECRET,
        refreshUrl: 'https://slack.com/api/oauth.v2.access',
      },
    }],
  },

  // Keep bot_token as manual fallback
  secureKeys: ['bot_token'],

  createClient: async (ctx) => {
    // Try OAuth first
    if (ctx.oauth) {
      const token = await ctx.oauth.getAccessToken('slack');
      if (token) return new WebClient(token);
    }
    // Fallback to manual bot token
    const botToken = await ctx.storage.get('bot_token');
    if (botToken) return new WebClient(botToken);

    ctx.logger.warn('No Slack token configured');
    return null;
  },

  methods: [
    {
      id: 'list_channels',
      description: 'List Slack channels, DMs, and group conversations',
      aiHint: 'Use to discover available channels and their IDs. Returns channel id, name, type. Call this BEFORE send_message to find the correct channelId.',
      inputSchema: listChannelsInput,
      handler: async (client, input) => {
        const { types, limit } = input as z.infer<typeof listChannelsInput>;
        const result = await client.conversations.list({
          types: types ?? 'public_channel,private_channel,im',
          limit: limit ?? 100,
          exclude_archived: true,
        });

        const rawChannels = result.channels ?? [];

        // Batch-resolve DM user names
        const imUserIds = rawChannels
          .filter((c: any) => c.is_im && c.user)
          .map((c: any) => c.user as string);

        const userNameMap = new Map<string, string>();
        if (imUserIds.length > 0) {
          try {
            const usersResult = await client.users.list({ limit: 200 });
            for (const u of usersResult.members ?? []) {
              const uid = (u as any).id;
              const profile = (u as any).profile;
              if (uid && profile) {
                userNameMap.set(uid, profile.display_name || profile.real_name || (u as any).name || uid);
              }
            }
          } catch {
            // user list failed, DMs will keep channel IDs as names
          }
        }

        return {
          channels: rawChannels.map((c: any) => {
            const name = c.is_im
              ? (userNameMap.get(c.user) ?? c.id)
              : (c.name ?? c.id);
            return {
              id: c.id,
              name,
              displayName: c.is_im ? `DM with ${name}` : `#${name}`,
              isPrivate: c.is_private ?? false,
              isIm: c.is_im ?? false,
              isMpim: c.is_mpim ?? false,
              isArchived: c.is_archived ?? false,
              topic: c.topic?.value ?? undefined,
              purpose: c.purpose?.value ?? undefined,
              memberCount: c.num_members ?? undefined,
            };
          }),
        };
      },
    },
    {
      id: 'list_users',
      description: 'List workspace members',
      aiHint: 'Use to discover workspace members and their user IDs.',
      inputSchema: listUsersInput,
      handler: async (client, input) => {
        const { limit } = input as z.infer<typeof listUsersInput>;
        const result = await client.users.list({ limit: limit ?? 100 });

        return {
          users: (result.members ?? [])
            .filter((u: any) => !u.deleted)
            .map((u: any) => ({
              id: u.id,
              name: u.name,
              displayName: u.profile?.display_name || u.profile?.real_name || u.name,
              avatar: u.profile?.image_48 ?? undefined,
              isBot: u.is_bot ?? false,
            })),
        };
      },
    },
    {
      id: 'get_channel_info',
      description: 'Get detailed channel information',
      aiHint: 'Use to get details about a specific channel including topic, purpose, and member count.',
      inputSchema: getChannelInfoInput,
      handler: async (client, input) => {
        const { channelId } = input as z.infer<typeof getChannelInfoInput>;
        const result = await client.conversations.info({ channel: channelId });
        const c = result.channel as any;

        return {
          id: c.id,
          name: c.name ?? c.id,
          isPrivate: c.is_private ?? false,
          isIm: c.is_im ?? false,
          isMpim: c.is_mpim ?? false,
          isArchived: c.is_archived ?? false,
          topic: c.topic?.value ?? undefined,
          purpose: c.purpose?.value ?? undefined,
          memberCount: c.num_members ?? undefined,
        };
      },
    },
    {
      id: 'search_messages',
      description: 'Search Slack messages',
      aiHint: 'Use for full-text search across messages. Returns matching messages with channel and author info.',
      inputSchema: searchMessagesInput,
      handler: async (client, input) => {
        const { query, limit } = input as z.infer<typeof searchMessagesInput>;
        const result = await client.search.messages({
          query,
          count: limit ?? 20,
          sort: 'timestamp',
          sort_dir: 'desc',
        });

        return {
          messages: (result.messages?.matches ?? []).map((m: any) => ({
            id: `${m.channel?.id}-${m.ts}`,
            text: m.text ?? '',
            userId: m.user ?? '',
            userName: m.username ?? undefined,
            channelId: m.channel?.id ?? '',
            channelName: m.channel?.name ?? undefined,
            ts: m.ts,
            threadTs: m.thread_ts ?? undefined,
            permalink: m.permalink ?? undefined,
          })),
        };
      },
    },
    {
      id: 'send_message',
      description: 'Send a message to a Slack channel',
      aiHint: 'Use when the user wants to send a Slack message. Call list_channels first to find the channelId. Optionally pass threadTs for threaded replies.',
      inputSchema: sendMessageInput,
      mutation: true,
      handler: async (client, input) => {
        const { channelId, text, threadTs } = input as z.infer<typeof sendMessageInput>;
        const result = await client.chat.postMessage({
          channel: channelId,
          text,
          thread_ts: threadTs,
        });

        return {
          success: result.ok,
          message: result.ok
            ? `Sent message to ${channelId}`
            : 'Failed to send message',
          ts: result.ts,
          channelId,
        };
      },
    },
    {
      id: 'reply_to_thread',
      description: 'Reply to a thread in Slack',
      aiHint: 'Use to reply in an existing thread. Requires channelId and the parent message threadTs.',
      inputSchema: replyToThreadInput,
      mutation: true,
      handler: async (client, input) => {
        const { channelId, threadTs, text } = input as z.infer<typeof replyToThreadInput>;
        const result = await client.chat.postMessage({
          channel: channelId,
          text,
          thread_ts: threadTs,
        });

        return {
          success: result.ok,
          message: result.ok
            ? `Replied in thread in ${channelId}`
            : 'Failed to reply in thread',
          ts: result.ts,
        };
      },
    },
    {
      id: 'add_reaction',
      description: 'Add an emoji reaction to a message',
      aiHint: 'Use to react to a message with an emoji. The emoji name should be without colons (e.g., "thumbsup" not ":thumbsup:").',
      inputSchema: addReactionInput,
      mutation: true,
      handler: async (client, input) => {
        const { channelId, ts, emoji } = input as z.infer<typeof addReactionInput>;
        const result = await client.reactions.add({
          channel: channelId,
          timestamp: ts,
          name: emoji,
        });

        return {
          success: result.ok,
          message: result.ok
            ? `Added :${emoji}: reaction`
            : 'Failed to add reaction',
        };
      },
    },
    {
      id: 'edit_message',
      description: 'Edit an existing Slack message',
      aiHint: 'Use to edit a message you previously sent. Requires channelId and the message ts.',
      inputSchema: editMessageInput,
      mutation: true,
      handler: async (client, input) => {
        const { channelId, ts, text } = input as z.infer<typeof editMessageInput>;
        const result = await client.chat.update({
          channel: channelId,
          ts,
          text,
        });

        return {
          success: result.ok,
          message: result.ok
            ? 'Message edited successfully'
            : 'Failed to edit message',
        };
      },
    },
    {
      id: 'delete_message',
      description: 'Delete a Slack message',
      aiHint: 'Use to delete a message. Requires channelId and the message ts. Only works for messages you sent.',
      inputSchema: deleteMessageInput,
      mutation: true,
      handler: async (client, input) => {
        const { channelId, ts } = input as z.infer<typeof deleteMessageInput>;
        const result = await client.chat.delete({
          channel: channelId,
          ts,
        });

        return {
          success: result.ok,
          message: result.ok
            ? 'Message deleted successfully'
            : 'Failed to delete message',
        };
      },
    },
    {
      id: 'mark_read',
      description: 'Mark a conversation as read up to a given timestamp',
      aiHint: 'Use to mark a channel/DM as read. Requires channelId and the latest message ts to mark as read.',
      inputSchema: markReadInput,
      mutation: true,
      handler: async (client, input) => {
        const { channelId, ts } = input as z.infer<typeof markReadInput>;
        const result = await client.conversations.mark({
          channel: channelId,
          ts,
        });

        return {
          success: result.ok,
          message: result.ok
            ? `Marked ${channelId} as read`
            : 'Failed to mark as read',
        };
      },
    },
  ],
});

export default slackIntegration;
