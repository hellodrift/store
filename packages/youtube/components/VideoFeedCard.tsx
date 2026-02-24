/**
 * YouTube Video Feed Card
 *
 * feed-card canvas for youtube_video entities.
 * Renders a thumbnail poster with click-to-play embedded YouTube player,
 * sized and styled for the feed (always full card, no compact chip mode).
 *
 * Props follow the feed-card contract:
 *   { uri, entityType, pathSegments, title, subtitle, metadata, size }
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useEntityQuery, gql, logger } from '@drift/plugin-api';

// ---------- GraphQL ----------

const GET_VIDEO = gql`
  query GetYoutubeVideoFeedCard($videoId: String!) {
    youtubeVideo(videoId: $videoId) {
      id
      videoId
      title
      channelTitle
      thumbnailUrl
      embedUrl
      watchUrl
    }
  }
`;

// ---------- Types ----------

interface YoutubeVideo {
  id: string;
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  embedUrl: string;
  watchUrl: string;
}

interface FeedCardProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  title?: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
  size: 'small' | 'medium' | 'large' | 'full';
}

// ---------- YouTube Logo ----------

function YTLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.71} viewBox="0 0 24 17" fill="none">
      <path
        d="M23.5 2.661C23.223 1.643 22.418.83 21.409.551 19.522 0 12 0 12 0S4.478 0 2.59.551C1.582.83.777 1.643.5 2.661 0 4.566 0 8.5 0 8.5s0 3.934.5 5.839c.277 1.018 1.082 1.831 2.09 2.11C4.479 17 12 17 12 17s7.522 0 9.41-.551c1.008-.279 1.813-1.092 2.09-2.11C24 12.434 24 8.5 24 8.5s0-3.934-.5-5.839Z"
        fill="#FF0000"
      />
      <path d="M9.6 12.143V4.857L15.853 8.5 9.6 12.143Z" fill="#fff" />
    </svg>
  );
}

// ---------- Feed Card ----------

function VideoFeedCardContent({ video, loading, error }: { video?: YoutubeVideo; loading: boolean; error?: { message: string } }) {
  const [playing, setPlaying] = useState(false);
  const playStartedAt = useRef<number>(0);

  const handlePlay = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!playing || !video) return;
    playStartedAt.current = Date.now();
    sessionStorage.setItem(`yt-playing-${video.videoId}`, JSON.stringify({
      playing: true,
      timestamp: 0,
      savedAt: Date.now(),
    }));

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - playStartedAt.current) / 1000);
      sessionStorage.setItem(`yt-playing-${video.videoId}`, JSON.stringify({
        playing: true,
        timestamp: elapsed,
        savedAt: Date.now(),
      }));
    }, 3000);

    return () => { clearInterval(interval); };
  }, [playing, video]);

  if (loading) {
    return (
      <div style={{
        borderRadius: '10px',
        border: '1px solid var(--border-muted)',
        overflow: 'hidden',
        background: 'var(--surface-subtle)',
      }}>
        <div style={{ width: '100%', paddingBottom: '56.25%', background: 'var(--surface-hover)', position: 'relative' }} />
        <div style={{ padding: '12px 14px' }}>
          <div style={{ height: '13px', width: '70%', borderRadius: '4px', background: 'var(--surface-hover)', marginBottom: '8px' }} />
          <div style={{ height: '11px', width: '40%', borderRadius: '4px', background: 'var(--surface-hover)' }} />
        </div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div style={{
        padding: '14px 16px',
        borderRadius: '10px',
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        color: 'var(--text-muted)',
        fontSize: '13px',
      }}>
        {error ? `Failed to load video: ${error.message}` : 'Video not found'}
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: '10px',
      border: '1px solid var(--border-muted)',
      overflow: 'hidden',
      background: 'var(--surface-page)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* Player / Thumbnail */}
      <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%' }}>
        {playing ? (
          <iframe
            src={`${video.embedUrl}&autoplay=1`}
            title={video.title}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%',
              border: 'none',
            }}
          />
        ) : (
          <div
            onClick={handlePlay}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%',
              cursor: 'pointer',
              background: '#000',
            }}
          >
            <img
              src={video.thumbnailUrl}
              alt={video.title}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={(e) => {
                const img = e.currentTarget;
                if (!img.src.includes('hqdefault')) {
                  img.src = video.thumbnailUrl.replace('mqdefault', 'hqdefault');
                }
              }}
            />
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '64px', height: '46px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <YTLogo size={64} />
            </div>
          </div>
        )}
      </div>

      {/* Video info */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{
          fontSize: '13px', fontWeight: 600,
          color: 'var(--text-primary)',
          lineHeight: 1.3,
          marginBottom: '4px',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {video.title}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px', color: 'var(--text-muted)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <YTLogo size={10} />
            {video.channelTitle}
          </span>
          <a
            href={video.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: '#FF0000', textDecoration: 'none', fontSize: '11px' }}
          >
            Open ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// ---------- Main Export ----------

export default function VideoFeedCard({ uri, pathSegments }: FeedCardProps) {
  const videoId = pathSegments[0];

  const { data, loading, error } = useEntityQuery(GET_VIDEO, {
    variables: { videoId },
    skip: !videoId,
  });

  const video = data?.youtubeVideo as YoutubeVideo | undefined;

  if (error) {
    logger.error('Failed to load YouTube video for feed card', { videoId, uri, error: error.message });
  }

  return <VideoFeedCardContent video={video} loading={loading} error={error} />;
}
