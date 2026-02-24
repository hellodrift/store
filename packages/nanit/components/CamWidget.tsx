/**
 * Nanit Camera Widget
 *
 * entity-widget canvas for nanit_cam entities.
 * Renders in two modes:
 * - compact: inline chip with camera emoji + "Nanit Cam"
 * - full card: live HLS stream from the Nanit camera
 *
 * When the user scrolls past the card, the floating-widget (CamFloatingWidget)
 * auto-detaches and becomes a mini picture-in-picture live stream.
 *
 * Auth is read from plugin storage (shared with the drawer login flow).
 * If the token is expired, it auto-refreshes using the stored refresh token.
 */

import { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { usePluginStorage, logger } from '@drift/plugin-api';
import { STREAM_URL, TOKENS_URL, LOW_LATENCY_HLS_CONFIG, ipcFetch, getValidToken, type StoredAuth } from './nanit-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WidgetProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  compact: boolean;
  messageId: string;
}

// ─── Chip (compact) ──────────────────────────────────────────────────────────

function CamChip({ label }: { label?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '2px 8px', borderRadius: '4px',
      background: '#6366f1', color: '#fff',
      fontSize: '12px', fontWeight: 500,
    }}>
      <span style={{ fontSize: 11 }}>📹</span>
      {label ?? 'Nanit Cam'}
    </span>
  );
}

// ─── HLS Stream Card ─────────────────────────────────────────────────────────

function StreamCard({ accessToken }: { accessToken: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    async function startStream() {
      if (!Hls.isSupported()) {
        setError('HLS not supported');
        return;
      }

      // Get baby_token via IPC
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
        logger.warn('Nanit widget: /tokens error', { err: String(e) });
      }

      if (cancelled) return;

      // Test manifest
      const headers: Record<string, string> = {
        'accept': '*/*',
        'origin': 'https://my.nanit.com',
        'referer': 'https://my.nanit.com/',
      };
      if (babyToken) headers['cookie'] = `baby_token=${babyToken}`;

      try {
        const diagResp = await ipcFetch(STREAM_URL, { headers });
        const diagBody = atob(diagResp.body);
        if (!diagResp.ok || !diagBody.includes('#EXTM3U')) {
          setError('Cannot access stream');
          setLoading(false);
          return;
        }
      } catch {
        setError('Cannot access stream');
        setLoading(false);
        return;
      }

      if (cancelled) return;

      // Start HLS with IPC loader
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
          logger.error('Nanit widget: HLS fatal error', { type: data.type, details: data.details });
          setError(`Stream error: ${data.details}`);
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
        overflow: 'hidden',
        background: 'var(--surface-subtle)',
        padding: '24px 16px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>📹</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{error}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Open the Nanit drawer to sign in
        </div>
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: '10px',
      border: '1px solid var(--border-muted)',
      overflow: 'hidden',
      background: '#000',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* Video */}
      <div style={{ position: 'relative', width: '100%' }}>
        {loading && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#000', zIndex: 1,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Connecting...</div>
          </div>
        )}
        <video
          ref={videoRef}
          controls
          muted
          playsInline
          style={{ width: '100%', display: 'block', borderRadius: loading ? '10px' : '10px 10px 0 0' }}
        />
      </div>

      {/* Info bar */}
      <div style={{
        padding: '10px 14px',
        background: 'var(--surface-page)',
        borderTop: '2px solid #6366f1',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
          }}>
            <span style={{ fontSize: 14 }}>📹</span>
            Nanit Live
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 10, color: '#22c55e', fontWeight: 500,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#22c55e', display: 'inline-block',
            }} />
            LIVE
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function CamWidget({ label, compact }: WidgetProps) {
  const [storedAuth, setStoredAuth] = usePluginStorage<StoredAuth | null>('auth_v2', null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Auto-refresh expired tokens on mount
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

  if (compact) {
    return <CamChip label={label} />;
  }

  if (!authChecked) {
    return (
      <div style={{
        borderRadius: '10px',
        border: '1px solid var(--border-muted)',
        overflow: 'hidden',
        background: 'var(--surface-subtle)',
        padding: '24px 16px',
        textAlign: 'center',
      }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Connecting...</div>
      </div>
    );
  }

  if (!accessToken) {
    return (
      <div style={{
        borderRadius: '10px',
        border: '1px solid var(--border-muted)',
        overflow: 'hidden',
        background: 'var(--surface-subtle)',
        padding: '24px 16px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>📹</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          Nanit Camera
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Open the Nanit drawer to sign in first
        </div>
      </div>
    );
  }

  return <StreamCard accessToken={accessToken} />;
}
