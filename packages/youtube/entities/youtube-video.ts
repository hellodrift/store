/**
 * youtube_video entity — Search and play YouTube videos in Drift.
 *
 * Uses youtube-search-api (no API key needed) for searching.
 * Uses YouTube oEmbed API for resolving video metadata by ID.
 * Playback is done via YouTube IFrame embed (no key needed).
 *
 * URI format: @drift//youtube_video/{videoId}
 * Example:    @drift//youtube_video/dQw4w9WgXcQ
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';

// ---------- Schema ----------

const youtubeVideoSchema = z.object({
  id: z.string(),
  type: z.literal('youtube_video'),
  uri: z.string(),
  title: z.string(),
  channelTitle: z.string(),
  thumbnailUrl: z.string(),
  description: z.string().optional(),
  publishedAt: z.string().optional(),
  embedUrl: z.string(),
  watchUrl: z.string(),
});

type YoutubeVideo = z.infer<typeof youtubeVideoSchema>;

// ---------- Helpers ----------

function buildEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?controls=1&rel=0&modestbranding=1`;
}

function buildWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function buildThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function extractVideoId(input: string): string | null {
  // Handle raw video ID (11 chars, alphanumeric + - _)
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }
  // Handle youtube.com/watch?v=ID
  const watchMatch = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  // Handle youtu.be/ID
  const shortMatch = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  // Handle youtube.com/embed/ID
  const embedMatch = input.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  return null;
}

async function fetchOEmbed(videoId: string): Promise<Partial<YoutubeVideo> | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      id: videoId,
      type: 'youtube_video',
      uri: `@drift//youtube_video/${videoId}`,
      title: data.title ?? `YouTube Video`,
      channelTitle: data.author_name ?? 'Unknown Channel',
      thumbnailUrl: data.thumbnail_url ?? buildThumbnail(videoId),
      embedUrl: buildEmbedUrl(videoId),
      watchUrl: buildWatchUrl(videoId),
    };
  } catch {
    return null;
  }
}

// ---------- Action input schemas ----------

const openVideoInput = z.object({
  videoId: z.string().describe('The YouTube video ID to open'),
});

// ---------- Entity definition ----------

const YoutubeVideoEntity = defineEntity({
  type: 'youtube_video',
  displayName: 'YouTube Video',
  description: 'A YouTube video that can be played inline in Drift',
  icon: 'play-circle',

  schema: youtubeVideoSchema,

  uriPath: {
    segments: ['videoId'] as const,
    parse: (segments: string[]) => ({ videoId: segments[0] }),
    format: ({ videoId }: { videoId: string }) => videoId,
  },

  display: {
    emoji: '▶️',
    colors: {
      bg: '#FF0000',
      text: '#FFFFFF',
      border: '#CC0000',
    },
    description: 'YouTube videos — search and play inline in Drift',
    filterDescriptions: [
      { name: 'query', type: 'string', description: 'Search query for YouTube videos' },
    ],
    outputFields: [
      { key: 'channel', label: 'Channel', metadataPath: 'channelTitle', format: 'string' },
      { key: 'publishedAt', label: 'Published', metadataPath: 'publishedAt', format: 'date' },
      { key: 'watchUrl', label: 'Watch URL', metadataPath: 'watchUrl', format: 'string' },
    ],
  },

  cache: {
    ttl: 300_000, // 5 minutes
    maxSize: 100,
  },

  actions: [
    {
      id: 'open_in_youtube',
      label: 'Open in YouTube',
      description: 'Open this video in YouTube',
      icon: 'external-link',
      scope: 'instance',
      aiHint: 'Use when the user wants to open the video in YouTube directly',
      handler: async (params: EntityActionParams<YoutubeVideo>, _ctx: EntityResolverContext): Promise<EntityActionResult> => {
        if (!params.entity) return { success: false, message: 'No entity provided' };
        return {
          success: true,
          message: `Opening ${params.entity.title} in YouTube`,
          data: { url: params.entity.watchUrl },
        };
      },
    },
    {
      id: 'search_videos',
      label: 'Search Videos',
      description: 'Search YouTube for videos matching a query',
      icon: 'search',
      scope: 'type',
      aiHint: 'Use when the user wants to find YouTube videos. Provide a search query.',
      inputSchema: z.object({
        query: z.string().describe('Search query for YouTube videos'),
        limit: z.number().int().min(1).max(10).optional().describe('Number of results (default 5)'),
      }),
      handler: async (params: EntityActionParams<YoutubeVideo>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const input = params.input as { query: string; limit?: number };
        ctx.logger.info('Searching YouTube videos', { query: input.query });
        return {
          success: true,
          message: `Searched YouTube for "${input.query}"`,
          data: { query: input.query },
        };
      },
    },
  ],

  resolve: async ({ videoId }: { videoId: string }, ctx) => {
    ctx.logger.info('Resolving YouTube video', { videoId });

    // Extract video ID from URL if needed
    const cleanId = extractVideoId(videoId) ?? videoId;

    const oEmbed = await fetchOEmbed(cleanId);
    if (!oEmbed) {
      ctx.logger.warn('Failed to fetch oEmbed for video', { videoId: cleanId });
      // Return minimal entity even if oEmbed fails
      return {
        id: cleanId,
        type: 'youtube_video' as const,
        uri: `@drift//youtube_video/${cleanId}`,
        title: `YouTube Video`,
        channelTitle: 'Unknown Channel',
        thumbnailUrl: buildThumbnail(cleanId),
        embedUrl: buildEmbedUrl(cleanId),
        watchUrl: buildWatchUrl(cleanId),
      };
    }

    return oEmbed as YoutubeVideo;
  },

  search: async (query: string, options, ctx) => {
    const limit = options?.limit ?? 5;
    ctx.logger.info('Searching YouTube', { query, limit });

    try {
      // youtube-search-api is bundled via package.json
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const YoutubeSearchApi = require('youtube-search-api');

      const result = await YoutubeSearchApi.GetListByKeyword(query, false, limit + 2, [
        { type: 'video' },
      ]);

      const items = (result.items ?? []) as Array<{
        id: string;
        title: string;
        channelTitle?: string;
        thumbnail?: { thumbnails?: Array<{ url: string }> };
        type?: string;
      }>;

      const videos: YoutubeVideo[] = [];

      for (const item of items) {
        // Skip non-video items (playlists, channels)
        if (item.type && item.type !== 'video') continue;
        if (!item.id) continue;

        const videoId = item.id;
        const thumbnails = item.thumbnail?.thumbnails ?? [];
        // Prefer medium quality thumbnail (mqdefault)
        const thumbUrl = thumbnails.length > 1
          ? thumbnails[Math.min(1, thumbnails.length - 1)].url
          : buildThumbnail(videoId);

        videos.push({
          id: videoId,
          type: 'youtube_video' as const,
          uri: `@drift//youtube_video/${videoId}`,
          title: item.title ?? 'YouTube Video',
          channelTitle: item.channelTitle ?? 'Unknown Channel',
          thumbnailUrl: thumbUrl ?? buildThumbnail(videoId),
          embedUrl: buildEmbedUrl(videoId),
          watchUrl: buildWatchUrl(videoId),
        });

        if (videos.length >= limit) break;
      }

      ctx.logger.info('YouTube search complete', { query, resultCount: videos.length });
      return videos;
    } catch (err) {
      ctx.logger.error('YouTube search failed', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
});

export default YoutubeVideoEntity;
