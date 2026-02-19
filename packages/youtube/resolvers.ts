/**
 * YouTube GraphQL Resolvers
 *
 * Implements Query resolvers for YoutubeVideo.
 * No integration client or API key needed — uses YouTube's public oEmbed API.
 *
 * Note: Video search is handled by the entity's search() function
 * (compiled into entities/youtube-video.js with youtube-search-api bundled).
 * Claude invokes search via the entity_search MCP tool, not via GraphQL.
 * The GraphQL layer only needs to resolve individual videos by ID for widgets.
 */

function buildEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?controls=1&rel=0&modestbranding=1`;
}

function buildWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function buildThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

async function fetchOEmbed(videoId: string): Promise<{
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
} | null> {
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
      title: data.title ?? 'YouTube Video',
      channelTitle: data.author_name ?? 'Unknown Channel',
      thumbnailUrl: data.thumbnail_url ?? buildThumbnail(videoId),
    };
  } catch {
    return null;
  }
}

function toVideoEntity(videoId: string, meta: {
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}) {
  return {
    id: videoId,
    videoId,
    title: meta.title,
    channelTitle: meta.channelTitle,
    thumbnailUrl: meta.thumbnailUrl,
    embedUrl: buildEmbedUrl(videoId),
    watchUrl: buildWatchUrl(videoId),
  };
}

export default {
  YoutubeVideo: {
    linkedContext: (parent: { videoId: string; title: string; channelTitle: string; description?: string }) => {
      const lines = [
        `## YouTube Video: ${parent.title}`,
        `- **Channel**: ${parent.channelTitle}`,
        `- **Watch**: ${buildWatchUrl(parent.videoId)}`,
      ];
      if (parent.description) {
        lines.push('', '### Description', parent.description.slice(0, 500));
      }
      return lines.join('\n');
    },
  },

  Query: {
    youtubeVideo: async (
      _: unknown,
      { videoId }: { videoId: string },
      ctx: any,
    ) => {
      ctx.logger?.info('Fetching YouTube video', { videoId });

      const meta = await fetchOEmbed(videoId);
      if (!meta) {
        return toVideoEntity(videoId, {
          title: 'YouTube Video',
          channelTitle: 'Unknown Channel',
          thumbnailUrl: buildThumbnail(videoId),
        });
      }

      return toVideoEntity(videoId, meta);
    },
  },
};
