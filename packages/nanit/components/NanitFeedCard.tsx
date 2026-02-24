/**
 * Nanit Feed Card
 *
 * feed-card canvas for nanit_cam entities.
 * Renders the live HLS stream (or auth prompt) directly in the feed.
 * Clicking the card opens the entity drawer (handled by FeedWidgetSlot
 * via the widget's action property — use navigate with target "entity:<uri>").
 */

import { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { usePluginStorage, logger } from '@drift/plugin-api';
import { STREAM_URL, TOKENS_URL, LOW_LATENCY_HLS_CONFIG, ipcFetch, getValidToken, type StoredAuth } from './nanit-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeedCardProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  title?: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
  size: 'small' | 'medium' | 'large' | 'full';
}

// ─── Stream Card ─────────────────────────────────────────────────────────────

function StreamCard({ accessToken, title, size }: { accessToken: string; title?: string; size: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isSmall = size === 'small';

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    async function startStream() {
      if (!Hls.isSupported()) {
        setError('HLS not supported');
        return;
      }

      let babyToken: string | null = null;
      try {
        const tokResp = await ipcFetch(TOKENS_URL, {
          headers: {
            'accept': '*/*',
            'authorization': `token ${accessToken}`,
            'origin': 'https://my.nanit.com',
            'referer': 'https://my.nanit.com/',
          },
        });
        if (tokResp.ok) {
          const raw = atob(tokResp.body);
          const jwtMatch = raw.match(/(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
          babyToken = jwtMatch ? jwtMatch[1] : tokResp.body;
        }
      } catch (e) {
        logger.warn('Nanit feed card: /tokens error', { err: String(e) });
      }

      if (cancelled) return;

      const savedToken = babyToken;

      class NanitLoader {
        private aborted = false;
        private stats = {
          aborted: false, loaded: 0, total: 0, retry: 0, chunkCount: 0, bwEstimate: 0,
          loading: { start: 0, first: 0, end: 0 },
          parsing: { start: 0, end: 0 },
          buffering: { start: 0, first: 0, end: 0 },
        };

        load(context: { url: string }, _config: unknown, callbacks: {
          onSuccess: (r: unknown, s: unknown, c: unknown, n: unknown) => void;
          onError: (e: unknown, c: unknown, n: unknown, s: unknown) => void;
        }) {
          const url = context.url;
          const isManifest = url.includes('.m3u8');
          const h: Record<string, string> = {
            'accept': '*/*',
            'origin': 'https://my.nanit.com',
            'referer': 'https://my.nanit.com/',
          };
          if (savedToken) h['cookie'] = `baby_token=${savedToken}`;
          this.stats.loading.start = performance.now();

          ipcFetch(url, { headers: h })
            .then(resp => {
              if (this.aborted) return;
              this.stats.loading.first = performance.now();
              this.stats.loading.end = performance.now();
              if (!resp.ok) {
                callbacks.onError({ code: resp.status, text: resp.statusText }, context, null, this.stats);
                return;
              }
              if (isManifest) {
                const text = atob(resp.body);
                this.stats.loaded = text.length;
                callbacks.onSuccess({ data: text, url }, this.stats, context, null);
              } else {
                const binary = atob(resp.body);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                this.stats.loaded = bytes.byteLength;
                callbacks.onSuccess({ data: bytes.buffer, url }, this.stats, context, null);
              }
            })
            .catch(err => {
              if (!this.aborted) callbacks.onError({ code: 0, text: String(err) }, context, null, this.stats);
            });
        }
        abort() { this.aborted = true; }
        destroy() { this.aborted = true; }
        getCacheAge() { return null; }
        getResponseHeader() { return null; }
      }

      const hls = new Hls({
        loader: NanitLoader as unknown as typeof Hls.prototype.config.loader,
        ...LOW_LATENCY_HLS_CONFIG,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          logger.error('Nanit feed card: HLS fatal error', { type: data.type, details: data.details });
          setError('Stream error');
        }
      });

      hls.loadSource(STREAM_URL);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        if (hls.liveSyncPosition) {
          video.currentTime = hls.liveSyncPosition;
        }
        video.play().catch(() => {});
      });
    }

    startStream();

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [accessToken]);

  if (error) {
    return (
      <div style={{
        borderRadius: '10px',
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        padding: isSmall ? '16px 12px' : '24px 16px',
        textAlign: 'center',
        height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: isSmall ? 20 : 24, marginBottom: 6 }}>📹</div>
        <div style={{ fontSize: isSmall ? 11 : 13, color: 'var(--text-muted)' }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: '10px',
      border: '1px solid var(--border-muted)',
      overflow: 'hidden',
      background: '#000',
      height: '100%',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: isSmall ? 80 : 120 }}>
        {loading && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#000', zIndex: 1,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: isSmall ? 11 : 13 }}>Connecting...</div>
          </div>
        )}
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
      <div style={{
        padding: isSmall ? '6px 10px' : '10px 14px',
        background: 'var(--surface-page)',
        borderTop: '2px solid #6366f1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          gap: isSmall ? 4 : 6,
          fontSize: isSmall ? 11 : 13, fontWeight: 600, color: 'var(--text-primary)',
        }}>
          <span style={{ fontSize: isSmall ? 11 : 14 }}>📹</span>
          {title || 'Nanit Live'}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center',
          gap: isSmall ? 3 : 4,
          fontSize: isSmall ? 8 : 10, color: '#22c55e', fontWeight: 500,
        }}>
          <span style={{
            width: isSmall ? 4 : 6, height: isSmall ? 4 : 6, borderRadius: '50%',
            background: '#22c55e', display: 'inline-block',
          }} />
          LIVE
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function NanitFeedCard({ title, size }: FeedCardProps) {
  const [storedAuth, setStoredAuth] = usePluginStorage<StoredAuth | null>('auth_v2', null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const isSmall = size === 'small';

  // Auto-refresh expired tokens
  useEffect(() => {
    let cancelled = false;
    getValidToken(storedAuth, setStoredAuth).then(token => {
      if (!cancelled) {
        setAccessToken(token);
        setAuthChecked(true);
      }
    });
    return () => { cancelled = true; };
  }, [storedAuth?.tokenExpiry]);

  if (!authChecked) {
    return (
      <div style={{
        borderRadius: '10px',
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        padding: isSmall ? '16px 12px' : '24px 16px',
        textAlign: 'center',
        height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ color: 'var(--text-muted)', fontSize: isSmall ? 11 : 13 }}>Loading...</div>
      </div>
    );
  }

  if (!accessToken) {
    return (
      <div style={{
        borderRadius: '10px',
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        padding: isSmall ? '16px 12px' : '24px 16px',
        textAlign: 'center',
        height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: isSmall ? 20 : 24, marginBottom: 6 }}>📹</div>
        <div style={{ fontSize: isSmall ? 11 : 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          Nanit Camera
        </div>
        <div style={{ fontSize: isSmall ? 10 : 11, color: 'var(--text-muted)', marginTop: 2 }}>
          Sign in to view
        </div>
      </div>
    );
  }

  return <StreamCard accessToken={accessToken} title={title} size={size} />;
}
