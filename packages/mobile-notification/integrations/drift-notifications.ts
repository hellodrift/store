/**
 * Drift Notifications Integration — First-party integration that calls
 * Drift's own sendSelfNotification GraphQL mutation using the user's
 * existing auth token.
 */

import { defineIntegration } from '@drift/entity-sdk';

// ---------- Client type ----------

interface SendSelfNotificationInput {
  title: string;
  body: string;
  category?: string;
  data?: Record<string, unknown>;
}

interface SendSelfNotificationResult {
  success: boolean;
  sent: number;
  error: string | null;
}

interface DriftNotificationsClient {
  sendSelfNotification(input: SendSelfNotificationInput): Promise<SendSelfNotificationResult>;
}

// ---------- GraphQL mutation ----------

const SEND_SELF_NOTIFICATION_MUTATION = `
  mutation SendSelfNotification($input: SendSelfNotificationInput!) {
    sendSelfNotification(input: $input) {
      success
      sent
      error
    }
  }
`;

// ---------- Integration definition ----------

export const driftNotificationsIntegration = defineIntegration<DriftNotificationsClient>({
  id: 'drift_notifications',
  displayName: 'Drift Notifications',
  description: 'Send push notifications to your own mobile devices via Drift',
  icon: 'bell',

  firstParty: true,
  secureKeys: ['auth_token', 'api_url'],

  createClient: async (ctx) => {
    const authToken = await ctx.storage.get('auth_token');
    const apiUrl = await ctx.storage.get('api_url');

    if (!authToken || !apiUrl) {
      ctx.logger.warn('Missing auth_token or api_url for drift_notifications');
      return null;
    }

    return {
      async sendSelfNotification(input: SendSelfNotificationInput): Promise<SendSelfNotificationResult> {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            query: SEND_SELF_NOTIFICATION_MUTATION,
            variables: { input },
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text}`);
        }

        const json = (await response.json()) as {
          data?: { sendSelfNotification: SendSelfNotificationResult };
          errors?: Array<{ message: string }>;
        };

        if (json.errors?.length) {
          throw new Error(json.errors.map((e) => e.message).join('; '));
        }

        return json.data!.sendSelfNotification;
      },
    };
  },

  methods: [
    {
      id: 'send_notification',
      description: 'Send a push notification to your own mobile devices',
      aiHint: 'Use when the user wants to send a push notification, reminder, or alert to their own phone/mobile device',
      handler: async (client, input) => {
        const { title, body, category, data } = input as SendSelfNotificationInput;
        return client.sendSelfNotification({ title, body, category, data });
      },
    },
  ],
});

export default driftNotificationsIntegration;
