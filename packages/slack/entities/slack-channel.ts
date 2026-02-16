/**
 * slack_channel entity — Slack channels, DMs, and group conversations.
 *
 * Uses the `slack` integration for auth and API calls.
 * Actions: send_message, mark_as_read.
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';
import type { WebClient } from '@slack/web-api';

// ---------- Schema ----------

const slackChannelSchema = z.object({
  id: z.string(),
  type: z.literal('slack_channel'),
  uri: z.string(),
  title: z.string(),
  name: z.string(),
  isPrivate: z.boolean(),
  isIm: z.boolean(),
  isMpim: z.boolean(),
  isArchived: z.boolean().optional(),
  topic: z.string().optional(),
  purpose: z.string().optional(),
  memberCount: z.number().optional(),
  unreadCount: z.number().optional(),
});

type SlackChannel = z.infer<typeof slackChannelSchema>;

// ---------- Helpers ----------

function getClient(ctx: EntityResolverContext): WebClient | null {
  return (ctx as any).integrations?.slack?.client ?? null;
}

// ---------- Action input schemas ----------

const sendMessageInput = z.object({
  text: z.string().describe('Message text to send in this channel'),
});

// ---------- Entity definition ----------

const SlackChannelEntity = defineEntity({
  type: 'slack_channel',
  displayName: 'Slack Channel',
  description: 'A Slack channel, DM, or group conversation',
  icon: 'hash',

  schema: slackChannelSchema,

  uriPath: {
    segments: ['id'] as const,
    parse: (segments: string[]) => ({ id: segments[0] }),
    format: ({ id }: { id: string }) => id,
  },

  display: {
    emoji: '#\uFE0F\u20E3',
    colors: {
      bg: '#36C5F0',
      text: '#FFFFFF',
      border: '#2eb3de',
    },
    description: 'Slack channels, DMs, and group conversations',
    outputFields: [
      { key: 'name', label: 'Name', metadataPath: 'name', format: 'string' },
      { key: 'topic', label: 'Topic', metadataPath: 'topic', format: 'string' },
      { key: 'members', label: 'Members', metadataPath: 'memberCount', format: 'number' },
    ],
  },

  integrations: { slack: 'slack' },

  cache: {
    ttl: 60_000,
    maxSize: 100,
  },

  actions: [
    {
      id: 'send_message',
      label: 'Send Message',
      description: 'Send a message in this channel',
      icon: 'message-square',
      scope: 'instance',
      aiHint: 'Use to send a message in this channel.',
      inputSchema: sendMessageInput,
      handler: async (params: EntityActionParams<SlackChannel>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Slack token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof sendMessageInput>;
        ctx.logger.info('Sending message to Slack channel', { channelId: params.entity.id });

        try {
          const result = await client.chat.postMessage({
            channel: params.entity.id,
            text: input.text,
          });

          if (!result.ok) return { success: false, message: `Failed to send message: ${result.error}` };

          const channelLabel = params.entity.isIm
            ? `DM with ${params.entity.name}`
            : `#${params.entity.name}`;

          return {
            success: true,
            message: `Sent message to ${channelLabel}`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.logger.error('Failed to send Slack message', { channelId: params.entity.id, error: errMsg });
          return { success: false, message: `Failed to send message: ${errMsg}` };
        }
      },
    },
    {
      id: 'mark_as_read',
      label: 'Mark as Read',
      description: 'Mark this channel as read',
      icon: 'check',
      scope: 'instance',
      aiHint: 'Use to mark this channel as read.',
      handler: async (params: EntityActionParams<SlackChannel>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No Slack token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        // Get latest message timestamp
        const history = await client.conversations.history({
          channel: params.entity.id,
          limit: 1,
        });

        const latestTs = history.messages?.[0]?.ts;
        if (!latestTs) return { success: true, message: 'No messages to mark as read' };

        const result = await client.conversations.mark({
          channel: params.entity.id,
          ts: latestTs,
        });

        if (!result.ok) return { success: false, message: 'Failed to mark as read' };

        return {
          success: true,
          message: `Marked #${params.entity.name} as read`,
        };
      },
    },
  ],

  resolve: async ({ id }: { id: string }, ctx) => {
    const client = getClient(ctx);
    if (!client) return null;

    ctx.logger.info('Resolving slack channel', { channelId: id });

    try {
      const result = await client.conversations.info({ channel: id });
      const c = result.channel as any;
      if (!c) return null;

      let name = c.name ?? c.id;

      // For DMs, resolve the user's display name
      if (c.is_im && c.user) {
        try {
          const userResult = await client.users.info({ user: c.user });
          const profile = (userResult.user as any)?.profile;
          if (profile) {
            name = profile.display_name || profile.real_name || name;
          }
        } catch {
          // user resolution failed, keep channel id as name
        }
      }

      return {
        id: c.id,
        type: 'slack_channel' as const,
        uri: `@drift//slack_channel/${c.id}`,
        title: c.is_im ? `DM with ${name}` : `#${name}`,
        name,
        isPrivate: c.is_private ?? false,
        isIm: c.is_im ?? false,
        isMpim: c.is_mpim ?? false,
        isArchived: c.is_archived ?? false,
        topic: c.topic?.value ?? undefined,
        purpose: c.purpose?.value ?? undefined,
        memberCount: c.num_members ?? undefined,
      };
    } catch (err) {
      ctx.logger.error('Failed to resolve slack channel', {
        channelId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  search: async (query: string, options, ctx) => {
    const client = getClient(ctx);
    if (!client) return [];

    const limit = options?.limit ?? 50;
    ctx.logger.info('Searching slack channels', { query, limit });

    try {
      const result = await client.conversations.list({
        types: 'public_channel,private_channel,im',
        limit,
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

      const channels = rawChannels
        .filter((c: any) => {
          if (!query || query === '*') return true;
          const name = c.is_im
            ? (userNameMap.get(c.user) ?? '').toLowerCase()
            : (c.name ?? '').toLowerCase();
          return name.includes(query.toLowerCase());
        })
        .map((c: any) => {
          const name = c.is_im
            ? (userNameMap.get(c.user) ?? c.id)
            : (c.name ?? c.id);
          return {
            id: c.id,
            type: 'slack_channel' as const,
            uri: `@drift//slack_channel/${c.id}`,
            title: c.is_im ? `DM with ${name}` : `#${name}`,
            name,
            isPrivate: c.is_private ?? false,
            isIm: c.is_im ?? false,
            isMpim: c.is_mpim ?? false,
            isArchived: c.is_archived ?? false,
            topic: c.topic?.value ?? undefined,
            purpose: c.purpose?.value ?? undefined,
            memberCount: c.num_members ?? undefined,
          };
        });

      return channels;
    } catch (err) {
      ctx.logger.error('Failed to search slack channels', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
});

export default SlackChannelEntity;
