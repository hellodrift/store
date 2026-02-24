/**
 * YouTube Video Floating Widget
 *
 * floating-widget canvas for youtube_video entities.
 * This is the detachable mini-player that appears when the user
 * scrolls past the video card in the chat feed.
 *
 * autoDetach: true in manifest — Drift automatically detaches
 * this widget from the chat and pins it as a floating overlay
 * when the original card scrolls out of view.
 *
 * Auto-plays immediately since the user was already watching the video
 * in the main card. Uses sessionStorage to pass the playback timestamp
 * from the entity-widget so playback continues roughly where it left off.
 */

import { useState, useEffect, useCallback } from 'react';
import { useEntityQuery, gql, logger } from '@drift/plugin-api';

const GET_VIDEO = gql`
  query GetYoutubeVideoFloat($videoId: String!) {
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

interface YoutubeVideo {
  id: string;
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  embedUrl: string;
  watchUrl: string;
}

interface FloatingWidgetProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  compact: boolean;
  messageId: string;
}

function YTLogo({ size = 12 }: { size?: number }) {
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

/**
 * Read the playback timestamp that the entity-widget stored in sessionStorage.
 * Returns seconds (integer) or 0 if nothing was stored / video wasn't playing.
 */
function getStoredTimestamp(videoId: string): number {
  try {
    const raw = sessionStorage.getItem(`yt-playing-${videoId}`);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { playing: boolean; timestamp?: number; savedAt?: number };
    if (!parsed.playing) return 0;
    // Estimate current position: stored timestamp + time elapsed since save
    const elapsed = parsed.savedAt ? Math.floor((Date.now() - parsed.savedAt) / 1000) : 0;
    return Math.max(0, Math.floor((parsed.timestamp ?? 0) + elapsed));
  } catch {
    return 0;
  }
}

export default function VideoFloatingWidget({ pathSegments }: FloatingWidgetProps) {
  const videoId = pathSegments[0];

  const { data, loading } = useEntityQuery(GET_VIDEO, {
    variables: { videoId },
    skip: !videoId,
  });

  const video = data?.youtubeVideo as YoutubeVideo | undefined;

  // Check if the main widget was playing (stored via sessionStorage)
  const [startTime] = useState(() => {
    const t = getStoredTimestamp(videoId);
    // Clear after reading so it doesn't persist stale state
    sessionStorage.removeItem(`yt-playing-${videoId}`);
    return t;
  });
  const wasPlaying = startTime > 0;

  // Start playing immediately if the main widget was playing, otherwise show thumbnail
  const [playing, setPlaying] = useState(wasPlaying);

  const handlePlay = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPlaying(true);
  }, []);

  if (loading || !video) {
    return (
      <div style={{ padding: '10px 12px' }}>
        <div style={{
          width: '100%', paddingBottom: '56.25%',
          background: 'var(--surface-hover)', borderRadius: '6px',
          position: 'relative', marginBottom: '8px',
        }} />
        <div style={{ height: '11px', width: '80%', borderRadius: '3px', background: 'var(--surface-hover)', marginBottom: '5px' }} />
        <div style={{ height: '10px', width: '50%', borderRadius: '3px', background: 'var(--surface-hover)' }} />
      </div>
    );
  }

  // Build embed URL with start time if resuming
  const embedSrc = playing
    ? `${video.embedUrl}&autoplay=1${startTime > 0 ? `&start=${startTime}` : ''}`
    : '';

  return (
    <div style={{ overflow: 'hidden' }}>
      {/* Mini video player */}
      <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%' }}>
        {playing ? (
          <iframe
            src={embedSrc}
            title={video.title}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
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
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }}
              onError={(e) => {
                const img = e.currentTarget;
                if (!img.src.includes('hqdefault')) {
                  img.src = video.thumbnailUrl.replace('mqdefault', 'hqdefault');
                }
              }}
            />
            {/* Play button */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '40px', height: '28px',
            }}>
              <YTLogo size={40} />
            </div>
          </div>
        )}
      </div>

      {/* Info bar */}
      <div style={{
        padding: '8px 10px',
        borderTop: '2px solid #FF0000',
      }}>
        <div style={{
          fontSize: '11px', fontWeight: 600,
          color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginBottom: '2px',
        }}>
          {video.title}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '10px', color: 'var(--text-muted)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <YTLogo size={9} />
            {video.channelTitle}
          </span>
          <a
            href={video.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: '#FF0000', textDecoration: 'none' }}
          >
            Open ↗
          </a>
        </div>
      </div>
    </div>
  );
}
