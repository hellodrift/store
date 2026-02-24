/**
 * nanit_cam entity — Live baby camera stream from Nanit.
 *
 * URI format: @drift//nanit_cam/{babyUid}
 * Example:    @drift//nanit_cam/ac5dd0b2
 *
 * When Claude outputs [[drift//nanit_cam/ac5dd0b2]], the entity-widget canvas
 * renders a live HLS stream card that auto-detaches into a floating PiP player.
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';

// ---------- Schema ----------

const nanitCamSchema = z.object({
  id: z.string(),
  type: z.literal('nanit_cam'),
  uri: z.string(),
  title: z.string(),
  babyUid: z.string(),
  name: z.string(),
  status: z.enum(['online', 'offline']),
});

type NanitCam = z.infer<typeof nanitCamSchema>;

// ---------- Entity definition ----------

const NanitCamEntity = defineEntity({
  type: 'nanit_cam',
  displayName: 'Nanit Camera',
  description: 'Live baby camera stream from Nanit — renders as a live video widget in chat',
  icon: 'video',

  schema: nanitCamSchema,

  uriPath: {
    segments: ['babyUid'] as const,
    parse: (segments: string[]) => ({ babyUid: segments[0] }),
    format: ({ babyUid }: { babyUid: string }) => babyUid,
  },

  display: {
    emoji: '📹',
    colors: {
      bg: '#6366f1',
      text: '#FFFFFF',
      border: '#4f46e5',
    },
    description: 'Live baby camera stream — shows a real-time video feed from Nanit',
    filterDescriptions: [],
    outputFields: [
      { key: 'name', label: 'Name', metadataPath: 'name', format: 'string' as const },
      { key: 'status', label: 'Status', metadataPath: 'status', format: 'string' as const },
    ],
    showInPalette: false,
  },

  cache: {
    ttl: 60_000, // 1 minute
    maxSize: 10,
  },

  actions: [
    {
      id: 'show_camera',
      label: 'Show Camera',
      description: 'Show the live camera feed in a widget card',
      icon: 'video',
      scope: 'type' as const,
      aiHint: 'Use when the user wants to see their Nanit baby camera. Returns a widget card with live video stream. The default baby UID is ac5dd0b2.',
      inputSchema: z.object({
        babyUid: z.string().optional().describe('Baby UID (defaults to ac5dd0b2)'),
      }),
      handler: async (params: EntityActionParams<NanitCam>, _ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const uid = (params.input as { babyUid?: string })?.babyUid || 'ac5dd0b2';
        return {
          success: true,
          message: `Showing Nanit camera for baby ${uid}`,
          data: { babyUid: uid },
        };
      },
    },
  ],

  resolve: async ({ babyUid }: { babyUid: string }, ctx) => {
    ctx.logger.info('Resolving Nanit camera', { babyUid });

    return {
      id: babyUid,
      type: 'nanit_cam' as const,
      uri: `@drift//nanit_cam/${babyUid}`,
      title: 'Nanit Camera',
      babyUid,
      name: 'Nanit Camera',
      status: 'online' as const,
    };
  },

  search: async (_query: string, _options, ctx) => {
    ctx.logger.info('Nanit cam search — returning default camera');
    return [
      {
        id: 'ac5dd0b2',
        type: 'nanit_cam' as const,
        uri: '@drift//nanit_cam/ac5dd0b2',
        title: 'Nanit Camera',
        babyUid: 'ac5dd0b2',
        name: 'Nanit Camera',
        status: 'online' as const,
      },
    ];
  },
});

export default NanitCamEntity;
