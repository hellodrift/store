/**
 * mobile_notification entity — Fire-and-forget push notification entity.
 *
 * Uses the drift_notifications integration to send push notifications
 * to the user's own mobile devices.
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';

// ---------- Schema ----------

const mobileNotificationSchema = z.object({
  id: z.string(),
  type: z.literal('mobile_notification'),
  uri: z.string(),
  title: z.string(),
  body: z.string(),
  category: z.string().optional(),
  sent: z.number(),
  sentAt: z.string(),
});

type MobileNotification = z.infer<typeof mobileNotificationSchema>;

// ---------- Action input ----------

const sendNotificationInput = z.object({
  title: z.string().describe('Notification title'),
  body: z.string().describe('Notification body text'),
  category: z
    .enum(['messages', 'mentions', 'updates', 'marketing', 'automations'])
    .optional()
    .describe('Notification category (defaults to automations). Users can disable categories in their mobile app settings.'),
  data: z.record(z.unknown()).optional().describe('Optional JSON data payload to attach to the notification'),
});

// ---------- Helpers ----------

function getClient(ctx: EntityResolverContext): { sendSelfNotification: (input: any) => Promise<any> } | null {
  return (ctx as any).integrations?.drift_notifications?.client ?? null;
}

// ---------- Entity definition ----------

const MobileNotificationEntity = defineEntity({
  type: 'mobile_notification',
  displayName: 'Mobile Notification',
  description: 'Send push notifications to your mobile devices',
  icon: 'bell',

  schema: mobileNotificationSchema,

  uriPath: {
    segments: ['id'] as const,
    parse: (segments: string[]) => ({ id: segments[0] }),
    format: ({ id }: { id: string }) => id,
  },

  display: {
    emoji: '\u{1F514}',
    colors: {
      bg: '#6366F1',
      text: '#FFFFFF',
      border: '#4F46E5',
    },
    description: 'Push notifications sent to your mobile devices',
    outputFields: [
      { key: 'title', label: 'Title', metadataPath: 'title', format: 'string' },
      { key: 'body', label: 'Body', metadataPath: 'body', format: 'string' },
      { key: 'category', label: 'Category', metadataPath: 'category', format: 'string' },
      { key: 'sent', label: 'Devices', metadataPath: 'sent', format: 'string' },
    ],
  },

  integrations: { drift_notifications: 'drift_notifications' },

  actions: [
    {
      id: 'send_notification',
      label: 'Send Notification',
      description: 'Send a push notification to your mobile devices',
      icon: 'bell',
      scope: 'type',
      aiHint: 'Use when the user wants to send a push notification, reminder, or alert to their own phone/mobile device',
      inputSchema: sendNotificationInput,
      handler: async (params: EntityActionParams<MobileNotification>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'Not authenticated — please log in first' };

        const input = params.input as z.infer<typeof sendNotificationInput>;
        const category = input.category ?? 'automations';

        ctx.logger.info('Sending mobile notification', { title: input.title, category });

        const result = await client.sendSelfNotification({
          title: input.title,
          body: input.body,
          category,
          data: input.data,
        });

        if (!result.success && result.error) {
          return { success: false, message: result.error };
        }

        const entity: MobileNotification = {
          id: `notif_${Date.now()}`,
          type: 'mobile_notification',
          uri: `@drift//mobile_notification/notif_${Date.now()}`,
          title: input.title,
          body: input.body,
          category,
          sent: result.sent,
          sentAt: new Date().toISOString(),
        };

        return {
          success: true,
          message: result.sent > 0
            ? `Sent notification "${input.title}" to ${result.sent} device(s)`
            : 'Notification sent but no active devices found',
          entity,
        };
      },
    },
  ],

  resolve: async () => null,
  search: async () => [],
});

export default MobileNotificationEntity;
