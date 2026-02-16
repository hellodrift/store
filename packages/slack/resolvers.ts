/**
 * Slack GraphQL Resolvers
 *
 * Implements Query and Mutation resolvers for Slack types.
 * Uses the Slack WebClient via resolver context injection.
 *
 * Context shape (injected by EntitySchemaRegistry):
 *   ctx.integrations.slack.client — WebClient instance
 *   ctx.logger — scoped logger
 */

// Helper: get Slack WebClient from context
function getClient(ctx: any): any | null {
  return ctx.integrations?.slack?.client ?? null;
}

// Helper: convert Slack API message to GraphQL SlackMessage
async function apiMessageToEntity(
  msg: any,
  channelId: string,
  client: any,
  channelName?: string,
): Promise<any> {
  let userName: string | undefined;
  let userAvatar: string | undefined;

  if (msg.user) {
    try {
      const userResult = await client.users.info({ user: msg.user });
      const profile = userResult.user?.profile;
      userName = profile?.display_name || profile?.real_name || msg.user;
      userAvatar = profile?.image_48;
    } catch {
      // user resolution failed
    }
  }

  return {
    id: `${channelId}-${msg.ts}`,
    type: 'slack_message',
    uri: `@drift//slack_message/${channelId}/${msg.ts}`,
    text: msg.text ?? '',
    userId: msg.user ?? '',
    userName,
    userAvatar,
    channelId,
    channelName,
    ts: msg.ts,
    threadTs: msg.thread_ts ?? null,
    replyCount: msg.reply_count ?? null,
    reactions: (msg.reactions ?? []).map((r: any) => ({
      name: r.name ?? '',
      count: r.count ?? 0,
    })),
    timestamp: msg.ts
      ? new Date(parseFloat(msg.ts) * 1000).toISOString()
      : null,
    url: null,
  };
}

// GraphQL Resolvers
export default {
  SlackMessage: {
    linkedContext: async (parent: any, _args: unknown, ctx: any) => {
      if (!parent.text) return null;

      const lines = [
        `## Slack Message`,
        parent.channelName ? `- **Channel**: #${parent.channelName}` : null,
        parent.userName ? `- **Author**: ${parent.userName}` : null,
        parent.timestamp ? `- **Time**: ${parent.timestamp}` : null,
        '',
        `### Message`,
        parent.text,
      ].filter((l) => l !== null);

      return lines.join('\n');
    },
  },

  Query: {
    slackMessage: async (
      _: unknown,
      { channelId, ts }: { channelId: string; ts: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return null;

      ctx.logger.info('Resolving slack message via GraphQL', { channelId, ts });

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

        // Get channel name
        let channelName: string | undefined;
        try {
          const channelResult = await client.conversations.info({ channel: channelId });
          channelName = channelResult.channel?.name;
        } catch {
          // channel resolution failed
        }

        return await apiMessageToEntity(msg, channelId, client, channelName);
      } catch (err: any) {
        ctx.logger.error('Failed to resolve slack message', {
          channelId,
          ts,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },

    slackMessages: async (
      _: unknown,
      { channelId, limit, before }: { channelId: string; limit?: number; before?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      ctx.logger.info('Fetching slack messages', { channelId, limit, before });

      try {
        const params: any = {
          channel: channelId,
          limit: limit ?? 30,
        };
        if (before) params.latest = before;

        const result = await client.conversations.history(params);

        // Get channel name once
        let channelName: string | undefined;
        try {
          const channelResult = await client.conversations.info({ channel: channelId });
          channelName = channelResult.channel?.name;
        } catch {
          // channel resolution failed
        }

        const messages = await Promise.all(
          (result.messages ?? []).map((msg: any) =>
            apiMessageToEntity(msg, channelId, client, channelName),
          ),
        );

        return messages;
      } catch (err: any) {
        ctx.logger.error('Failed to fetch slack messages', {
          channelId,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    slackChannels: async (
      _: unknown,
      { types, limit }: { types?: string; limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const result = await client.conversations.list({
          types: types ?? 'public_channel,private_channel,im',
          limit: limit ?? 100,
          exclude_archived: true,
        });

        const channels = result.channels ?? [];

        // Resolve DM user names: IMs have a `user` field instead of a name
        const imChannels = channels.filter((c: any) => c.is_im && c.user);
        const userIds = [...new Set(imChannels.map((c: any) => c.user as string))];
        const userNameMap = new Map<string, string>();

        // Batch-resolve user names (single users.list call is more efficient than N users.info calls)
        if (userIds.length > 0) {
          try {
            const usersResult = await client.users.list({ limit: 200 });
            for (const u of usersResult.members ?? []) {
              if (userIds.includes(u.id)) {
                userNameMap.set(
                  u.id,
                  u.profile?.display_name || u.profile?.real_name || u.name || u.id,
                );
              }
            }
          } catch {
            // Fall back to individual lookups if list fails
            for (const uid of userIds) {
              try {
                const userResult = await client.users.info({ user: uid });
                const profile = userResult.user?.profile;
                userNameMap.set(
                  uid,
                  profile?.display_name || profile?.real_name || userResult.user?.name || uid,
                );
              } catch {
                // leave unmapped — will fall back to ID
              }
            }
          }
        }

        // Batch-fetch unread counts via conversations.info (conversations.list doesn't include them)
        const unreadMap = new Map<string, number>();
        try {
          const infoResults = await Promise.allSettled(
            channels.map((c: any) =>
              client.conversations.info({ channel: c.id })
                .then((r: any) => ({ id: c.id, unread: r.channel?.unread_count ?? 0 }))
            ),
          );
          for (const r of infoResults) {
            if (r.status === 'fulfilled') {
              unreadMap.set(r.value.id, r.value.unread);
            }
          }
        } catch {
          // Non-fatal — unread counts are best-effort
        }

        return channels.map((c: any) => {
          let name = c.name ?? c.id;
          if (c.is_im && c.user && userNameMap.has(c.user)) {
            name = userNameMap.get(c.user)!;
          }

          return {
            id: c.id,
            name,
            isPrivate: c.is_private ?? false,
            isIm: c.is_im ?? false,
            isMpim: c.is_mpim ?? false,
            isArchived: c.is_archived ?? false,
            topic: c.topic?.value ?? null,
            purpose: c.purpose?.value ?? null,
            memberCount: c.num_members ?? null,
            unreadCount: unreadMap.get(c.id) ?? null,
          };
        });
      } catch (err: any) {
        ctx.logger.error('Failed to list slack channels', {
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    slackChannel: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return null;

      try {
        const result = await client.conversations.info({ channel: id });
        const c = result.channel as any;
        if (!c) return null;

        let name = c.name ?? c.id;

        // For DMs, resolve the other user's display name
        if (c.is_im && c.user) {
          try {
            const userResult = await client.users.info({ user: c.user });
            const profile = userResult.user?.profile;
            name = profile?.display_name || profile?.real_name || userResult.user?.name || name;
          } catch {
            // fall back to raw name
          }
        }

        return {
          id: c.id,
          name,
          isPrivate: c.is_private ?? false,
          isIm: c.is_im ?? false,
          isMpim: c.is_mpim ?? false,
          isArchived: c.is_archived ?? false,
          topic: c.topic?.value ?? null,
          purpose: c.purpose?.value ?? null,
          memberCount: c.num_members ?? null,
          unreadCount: c.unread_count ?? null,
        };
      } catch (err: any) {
        ctx.logger.error('Failed to get slack channel', {
          channelId: id,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },

    slackThread: async (
      _: unknown,
      { channelId, threadTs }: { channelId: string; threadTs: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return null;

      try {
        const result = await client.conversations.replies({
          channel: channelId,
          ts: threadTs,
        });

        // Get channel name
        let channelName: string | undefined;
        try {
          const channelResult = await client.conversations.info({ channel: channelId });
          channelName = channelResult.channel?.name;
        } catch {
          // channel resolution failed
        }

        const messages = await Promise.all(
          (result.messages ?? []).map((msg: any) =>
            apiMessageToEntity(msg, channelId, client, channelName),
          ),
        );

        return {
          channelId,
          threadTs,
          messages,
          replyCount: messages.length > 0 ? messages.length - 1 : 0,
        };
      } catch (err: any) {
        ctx.logger.error('Failed to get slack thread', {
          channelId,
          threadTs,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },

    slackUsers: async (_: unknown, { limit }: { limit?: number }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const result = await client.users.list({ limit: limit ?? 100 });

        return (result.members ?? [])
          .filter((u: any) => !u.deleted)
          .map((u: any) => ({
            id: u.id,
            name: u.name ?? '',
            displayName: u.profile?.display_name || u.profile?.real_name || u.name || null,
            avatar: u.profile?.image_48 ?? null,
            isBot: u.is_bot ?? false,
          }));
      } catch (err: any) {
        ctx.logger.error('Failed to list slack users', {
          error: err?.message ?? String(err),
        });
        return [];
      }
    },

    slackSearchMessages: async (
      _: unknown,
      { query, limit }: { query: string; limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const result = await client.search.messages({
          query,
          count: limit ?? 20,
          sort: 'timestamp',
          sort_dir: 'desc',
        });

        return (result.messages?.matches ?? []).map((m: any) => ({
          id: `${m.channel?.id}-${m.ts}`,
          type: 'slack_message',
          uri: `@drift//slack_message/${m.channel?.id}/${m.ts}`,
          text: m.text ?? '',
          userId: m.user ?? '',
          userName: m.username ?? null,
          userAvatar: null,
          channelId: m.channel?.id ?? '',
          channelName: m.channel?.name ?? null,
          ts: m.ts,
          threadTs: m.thread_ts ?? null,
          replyCount: null,
          reactions: [],
          timestamp: m.ts
            ? new Date(parseFloat(m.ts) * 1000).toISOString()
            : null,
          url: m.permalink ?? null,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to search slack messages', {
          query,
          error: err?.message ?? String(err),
        });
        return [];
      }
    },
  },

  Mutation: {
    sendSlackMessage: async (
      _: unknown,
      { channelId, text, threadTs }: { channelId: string; text: string; threadTs?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Slack token configured' };

      ctx.logger.info('Sending Slack message via GraphQL', { channelId });

      try {
        const params: any = { channel: channelId, text };
        if (threadTs) params.thread_ts = threadTs;

        const result = await client.chat.postMessage(params);
        return {
          success: result.ok ?? false,
          message: result.ok ? `Message sent to ${channelId}` : 'Failed to send message',
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to send message: ${err?.message ?? String(err)}`,
        };
      }
    },

    editSlackMessage: async (
      _: unknown,
      { channelId, ts, text }: { channelId: string; ts: string; text: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Slack token configured' };

      ctx.logger.info('Editing Slack message via GraphQL', { channelId, ts });

      try {
        const result = await client.chat.update({ channel: channelId, ts, text });
        return {
          success: result.ok ?? false,
          message: result.ok ? 'Message edited' : 'Failed to edit message',
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to edit message: ${err?.message ?? String(err)}`,
        };
      }
    },

    deleteSlackMessage: async (
      _: unknown,
      { channelId, ts }: { channelId: string; ts: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Slack token configured' };

      ctx.logger.info('Deleting Slack message via GraphQL', { channelId, ts });

      try {
        const result = await client.chat.delete({ channel: channelId, ts });
        return {
          success: result.ok ?? false,
          message: result.ok ? 'Message deleted' : 'Failed to delete message',
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to delete message: ${err?.message ?? String(err)}`,
        };
      }
    },

    addSlackReaction: async (
      _: unknown,
      { channelId, ts, emoji }: { channelId: string; ts: string; emoji: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Slack token configured' };

      try {
        const result = await client.reactions.add({
          channel: channelId,
          timestamp: ts,
          name: emoji,
        });
        return {
          success: result.ok ?? false,
          message: result.ok ? `Added :${emoji}: reaction` : 'Failed to add reaction',
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to add reaction: ${err?.message ?? String(err)}`,
        };
      }
    },

    markSlackChannelRead: async (
      _: unknown,
      { channelId, ts }: { channelId: string; ts: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No Slack token configured' };

      try {
        const result = await client.conversations.mark({ channel: channelId, ts });
        return {
          success: result.ok ?? false,
          message: result.ok ? `Marked as read` : 'Failed to mark as read',
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to mark as read: ${err?.message ?? String(err)}`,
        };
      }
    },
  },
};
