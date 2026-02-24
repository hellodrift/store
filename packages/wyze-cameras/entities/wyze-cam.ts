/**
 * wyze_cam entity — Live camera stream from Wyze.
 *
 * URI format: @drift//wyze_cam/{cameraNameUri}
 * Example:    @drift//wyze_cam/laundry-room
 *
 * When Claude outputs [[@drift//wyze_cam/laundry-room]], the entity-widget canvas
 * renders a camera card with thumbnail. Clicking opens the entity-drawer with
 * a live WebRTC stream.
 *
 * Camera data is fetched from the Wyze bridge server (Python Flask).
 * Default bridge URL: http://localhost:5050
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';

// ---------- Constants ----------

const DEFAULT_BRIDGE_URL = 'http://localhost:5050';

// ---------- Schema ----------

const wyzeCamSchema = z.object({
  id: z.string(),
  type: z.literal('wyze_cam'),
  uri: z.string(),
  title: z.string(),
  cameraNameUri: z.string(),
  nickname: z.string(),
  online: z.boolean(),
  model_name: z.string().optional(),
});

type WyzeCam = z.infer<typeof wyzeCamSchema>;

// ---------- Bridge helpers ----------

async function getBridgeUrl(ctx: EntityResolverContext): Promise<string> {
  const stored = await ctx.storage.get('bridge_url');
  return stored || DEFAULT_BRIDGE_URL;
}

async function fetchCameras(ctx: EntityResolverContext): Promise<WyzeCam[]> {
  const bridgeUrl = await getBridgeUrl(ctx);
  try {
    const resp = await fetch(`${bridgeUrl}/api`);
    if (!resp.ok) return [];
    const data = await resp.json();
    if (!Array.isArray(data)) return [];

    return data.map((cam: any) => ({
      id: cam.name_uri || cam.mac,
      type: 'wyze_cam' as const,
      uri: `@drift//wyze_cam/${cam.name_uri || cam.mac}`,
      title: cam.nickname || cam.name_uri || cam.mac,
      cameraNameUri: cam.name_uri || cam.mac,
      nickname: cam.nickname || cam.name_uri || cam.mac,
      online: cam.online ?? false,
      model_name: cam.model_name,
    }));
  } catch (err) {
    ctx.logger.warn('Failed to fetch cameras from bridge', { err: String(err) });
    return [];
  }
}

// ---------- Entity definition ----------

const WyzeCamEntity = defineEntity({
  type: 'wyze_cam',
  displayName: 'Wyze Camera',
  description: 'Live camera stream from Wyze — renders as a video widget in chat',
  icon: 'video',

  schema: wyzeCamSchema,

  uriPath: {
    segments: ['cameraNameUri'] as const,
    parse: (segments: string[]) => ({ cameraNameUri: segments[0] }),
    format: ({ cameraNameUri }: { cameraNameUri: string }) => cameraNameUri,
  },

  display: {
    emoji: '📷',
    colors: {
      bg: '#FFDA27',
      text: '#000000',
      border: '#E5C422',
    },
    description: 'Live camera stream from Wyze',
    filterDescriptions: [],
    outputFields: [
      { key: 'nickname', label: 'Name', metadataPath: 'nickname', format: 'string' as const },
      { key: 'online', label: 'Online', metadataPath: 'online', format: 'string' as const },
      { key: 'model_name', label: 'Model', metadataPath: 'model_name', format: 'string' as const },
    ],
    showInPalette: false,
  },

  cache: {
    ttl: 30_000,
    maxSize: 20,
  },

  storage: {
    secureKeys: ['bridge_url'],
  },

  actions: [
    {
      id: 'show_camera',
      label: 'Show Camera',
      description: 'Show a specific Wyze camera live feed',
      icon: 'video',
      scope: 'type' as const,
      aiHint: 'Use when the user wants to see a specific Wyze camera. Pass the camera name_uri (e.g., "laundry-room", "front-door"). Returns a widget card with live video. If unsure which camera, use list_cameras first.',
      inputSchema: z.object({
        cameraNameUri: z.string().describe('Camera name_uri identifier (e.g., "laundry-room")'),
      }),
      handler: async (params: EntityActionParams<WyzeCam>, _ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const name = (params.input as { cameraNameUri: string }).cameraNameUri;
        return {
          success: true,
          message: `Showing Wyze camera: ${name}`,
          data: { cameraNameUri: name },
        };
      },
    },
    {
      id: 'list_cameras',
      label: 'List Cameras',
      description: 'List all available Wyze cameras',
      icon: 'list',
      scope: 'type' as const,
      aiHint: 'Use when the user wants to see all their Wyze cameras, or asks "show me my cameras". Returns a list of all connected cameras with their names and statuses.',
      inputSchema: z.object({}),
      handler: async (_params: EntityActionParams<WyzeCam>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const cameras = await fetchCameras(ctx);
        if (cameras.length === 0) {
          return {
            success: false,
            message: 'No cameras found. Make sure the Wyze bridge server is running (python wyze_server.py).',
          };
        }
        return {
          success: true,
          message: `Found ${cameras.length} camera(s)`,
          data: {
            cameras: cameras.map(c => ({
              name_uri: c.cameraNameUri,
              nickname: c.nickname,
              online: c.online,
              model: c.model_name,
            })),
          },
        };
      },
    },
  ],

  resolve: async ({ cameraNameUri }: { cameraNameUri: string }, ctx) => {
    ctx.logger.info('Resolving Wyze camera', { cameraNameUri });
    const cameras = await fetchCameras(ctx);
    const cam = cameras.find(c => c.cameraNameUri === cameraNameUri);
    if (cam) return cam;

    // Return a basic entity even if bridge is unreachable
    return {
      id: cameraNameUri,
      type: 'wyze_cam' as const,
      uri: `@drift//wyze_cam/${cameraNameUri}`,
      title: cameraNameUri,
      cameraNameUri,
      nickname: cameraNameUri,
      online: false,
    };
  },

  search: async (query: string, _options, ctx) => {
    ctx.logger.info('Wyze cam search', { query });
    const cameras = await fetchCameras(ctx);
    if (!query) return cameras;
    const q = query.toLowerCase();
    return cameras.filter(c =>
      c.nickname.toLowerCase().includes(q) ||
      c.cameraNameUri.toLowerCase().includes(q)
    );
  },
});

export default WyzeCamEntity;
