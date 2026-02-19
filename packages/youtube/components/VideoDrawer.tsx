/**
 * YouTube Video Drawer
 *
 * entity-drawer canvas for youtube_video entities.
 * Opens when the user clicks on a video card in the feed.
 *
 * Shows:
 * - Full embedded YouTube player (16:9)
 * - Video title + channel
 * - Description
 * - Open in YouTube link
 */

import { useState, useCallback } from 'react';
import { useEntityQuery, gql, logger } from '@drift/plugin-api';

const GET_VIDEO = gql`
  query GetYoutubeVideoDrawer($videoId: String!) {
    youtubeVideo(videoId: $videoId) {
      id
      videoId
      title
      channelTitle
      thumbnailUrl
      description
      publishedAt
      embedUrl
      watchUrl
    }
  }
`;

interface YoutubeVideo {
  id: string;
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  description?: string;
  publishedAt?: string;
  embedUrl: string;
  watchUrl: string;
}

interface DrawerProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
}

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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function VideoDrawer({ uri, pathSegments, label }: DrawerProps) {
  const videoId = pathSegments[0];
  const [playing, setPlaying] = useState(false);

  const { data, loading, error } = useEntityQuery(GET_VIDEO, {
    variables: { videoId },
    skip: !videoId,
  });

  const video = data?.youtubeVideo as YoutubeVideo | undefined;

  const handlePlay = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPlaying(true);
  }, []);

  if (error) {
    logger.error('Failed to load YouTube video for drawer', { videoId, uri, error: error.message });
  }

  if (loading) {
    return (
      <div style={{ padding: '0' }}>
        {/* Skeleton player */}
        <div style={{
          width: '100%', paddingBottom: '56.25%',
          background: 'var(--surface-hover)', position: 'relative',
        }} />
        <div style={{ padding: '16px' }}>
          <div style={{ height: '16px', width: '80%', borderRadius: '4px', background: 'var(--surface-hover)', marginBottom: '10px' }} />
          <div style={{ height: '12px', width: '50%', borderRadius: '4px', background: 'var(--surface-hover)', marginBottom: '16px' }} />
          <div style={{ height: '11px', width: '100%', borderRadius: '4px', background: 'var(--surface-hover)', marginBottom: '6px' }} />
          <div style={{ height: '11px', width: '90%', borderRadius: '4px', background: 'var(--surface-hover)', marginBottom: '6px' }} />
          <div style={{ height: '11px', width: '70%', borderRadius: '4px', background: 'var(--surface-hover)' }} />
        </div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
        {error ? `Failed to load video: ${error.message}` : 'Video not found'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Player */}
      <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', background: '#000', flexShrink: 0 }}>
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
                if (!img.src.includes('maxresdefault') && !img.src.includes('hqdefault')) {
                  img.src = video.thumbnailUrl.replace('mqdefault', 'hqdefault');
                }
              }}
            />
            {/* Play button */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '80px', height: '57px',
              filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.5))',
            }}>
              <YTLogo size={80} />
            </div>
            <div style={{
              position: 'absolute', bottom: '12px', right: '12px',
              fontSize: '11px', color: 'rgba(255,255,255,0.8)',
              background: 'rgba(0,0,0,0.6)', borderRadius: '4px',
              padding: '3px 7px',
            }}>
              Click to play
            </div>
          </div>
        )}
      </div>

      {/* Info section */}
      <div style={{ padding: '16px', overflowY: 'auto' }}>
        {/* Title */}
        <h2 style={{
          margin: '0 0 8px',
          fontSize: '15px', fontWeight: 600,
          color: 'var(--text-primary)', lineHeight: 1.3,
        }}>
          {video.title}
        </h2>

        {/* Channel + date row */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
          fontSize: '12px', color: 'var(--text-secondary)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <YTLogo size={12} />
            <strong>{video.channelTitle}</strong>
          </span>
          {video.publishedAt && (
            <span>{formatDate(video.publishedAt)}</span>
          )}
        </div>

        {/* Open in YouTube button */}
        <a
          href={video.watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '6px',
            width: '100%',
            padding: '10px 14px',
            fontSize: '13px', fontWeight: 500,
            borderRadius: '8px',
            background: '#FF0000', color: '#fff',
            textDecoration: 'none',
            marginBottom: '16px',
            boxSizing: 'border-box',
          }}
        >
          <YTLogo size={14} />
          Open in YouTube
        </a>

        {/* Description */}
        {video.description && (
          <div>
            <div style={{
              fontSize: '11px', fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '6px', textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Description
            </div>
            <p style={{
              margin: 0,
              fontSize: '12px', lineHeight: 1.6,
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
            }}>
              {video.description.slice(0, 800)}
              {video.description.length > 800 && '…'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
