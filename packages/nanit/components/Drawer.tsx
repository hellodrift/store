import { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import { DrawerHeaderTitle, DrawerHeaderActions } from '@drift/design/components';
import { Button, Input } from '@drift/design/primitives';
import { usePluginStorage, logger } from '@drift/plugin-api';

// ─── Nanit REST API (api.nanit.com) ──────────────────────────────────────────

const API_BASE = 'https://api.nanit.com';
const MEDIA_BASE = 'https://media-web-secured.nanit.com';
const BABY_UID = 'ac5dd0b2';
const STREAM_URL = `${MEDIA_BASE}/hls/babies/${BABY_UID}.m3u8`;
const TOKENS_URL = `${MEDIA_BASE}/babies/${BABY_UID}/tokens`;

const API_HEADERS = {
  'content-type': 'application/json',
  'nanit-api-version': '1',
  'accept': 'application/json',
};

// Step 1: POST /login with email + password → returns mfa_token
async function apiLogin(email: string, password: string): Promise<string> {
  const resp = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: API_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json();
  logger.info('Nanit API login', { status: resp.status, keys: Object.keys(data) });

  if (data.mfa_token) return data.mfa_token;
  if (data.access_token) return `__direct__${data.access_token}__${data.refresh_token || ''}`;
  throw new Error(data.error || data.message || `Login failed (${resp.status})`);
}

// Step 2: POST /login with email + password + mfa_code + mfa_token → returns access_token + refresh_token
async function apiMfaVerify(
  email: string,
  password: string,
  mfaCode: string,
  mfaToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const resp = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: API_HEADERS,
    body: JSON.stringify({ email, password, mfa_code: mfaCode, mfa_token: mfaToken }),
  });
  const data = await resp.json();
  logger.info('Nanit API MFA verify', { status: resp.status, keys: Object.keys(data) });

  if (data.access_token) {
    return { accessToken: data.access_token, refreshToken: data.refresh_token || '' };
  }
  throw new Error(data.error || data.message || `MFA verify failed (${resp.status})`);
}

// Refresh: POST /tokens/refresh → returns new access_token
async function apiRefresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const resp = await fetch(`${API_BASE}/tokens/refresh`, {
    method: 'POST',
    headers: API_HEADERS,
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await resp.json();
  logger.info('Nanit API refresh', { status: resp.status, keys: Object.keys(data) });

  if (data.access_token) {
    return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken };
  }
  throw new Error(data.error || data.message || `Token refresh failed (${resp.status})`);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthState = 'unauthenticated' | 'sending_mfa' | 'mfa_pending' | 'mfa_verifying' | 'authenticated' | 'error';

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number; // unix ms
  email: string;
  password: string;
}

interface DrawerProps {
  payload: { view?: string; [key: string]: unknown };
  drawer: {
    close: () => void;
    open: (payload: Record<string, unknown>) => void;
    push: (payload: Record<string, unknown>) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

// ─── IPC Fetch Helper ─────────────────────────────────────────────────────────
// All requests to nanit media servers go through Electron's main process via IPC
// to bypass CORS restrictions (renderer runs on localhost in dev mode).

async function ipcFetch(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
  ok: boolean; status: number; statusText: string; headers: Record<string, string>; body: string; // base64
}> {
  // @ts-ignore window.electron exists in Drift's preload
  return window.electron.invoke('drift:fetch', {
    url,
    method: options?.method || 'GET',
    headers: options?.headers,
    body: options?.body,
  });
}

// ─── HLS Player ───────────────────────────────────────────────────────────────

function HlsPlayer({ accessToken, onReauth }: { accessToken: string; onReauth: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  // Store baby_token in a ref so the HLS loader can access it
  const babyTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    async function startStream() {
      if (!Hls.isSupported()) {
        setPlayerError('HLS not supported');
        return;
      }

      // Step 1: call /babies/{uid}/tokens via IPC to get baby_token
      logger.info('Nanit: calling /tokens with access token via IPC...');
      try {
        const tokResp = await ipcFetch(TOKENS_URL, {
          headers: {
            'accept': '*/*',
            'authorization': `token ${accessToken}`,
            'origin': 'https://my.nanit.com',
            'referer': 'https://my.nanit.com/',
          },
        });
        logger.info('Nanit: /tokens', { status: tokResp.status, ok: tokResp.ok });
        if (tokResp.ok) {
          // Body is base64-encoded from the IPC handler
          const raw = atob(tokResp.body);
          logger.info('Nanit: /tokens body', { len: raw.length, preview: raw.slice(0, 100), isJwt: raw.startsWith('eyJ') });
          const jwtMatch = raw.match(/(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
          if (jwtMatch) {
            babyTokenRef.current = jwtMatch[1];
          } else {
            // Use raw base64 as the token value
            babyTokenRef.current = tokResp.body;
          }
          logger.info('Nanit: baby_token extracted', { len: babyTokenRef.current.length, preview: babyTokenRef.current.slice(0, 50) });
        }
      } catch (e) {
        logger.warn('Nanit: /tokens error', { err: String(e) });
      }

      if (cancelled) return;

      // Step 2: test manifest via IPC (send baby_token as cookie header)
      let manifestOk = false;
      try {
        const headers: Record<string, string> = {
          'accept': '*/*',
          'origin': 'https://my.nanit.com',
          'referer': 'https://my.nanit.com/',
        };
        if (babyTokenRef.current) {
          headers['cookie'] = `baby_token=${babyTokenRef.current}`;
        }
        const diagResp = await ipcFetch(STREAM_URL, { headers });
        const diagBody = atob(diagResp.body);
        logger.info('Nanit: manifest test', { status: diagResp.status, bodyLen: diagBody.length, preview: diagBody.slice(0, 300) });
        manifestOk = diagResp.ok && diagBody.includes('#EXTM3U');
      } catch (e) {
        logger.error('Nanit: manifest test error', { err: String(e) });
      }

      if (cancelled) return;

      if (!manifestOk) {
        setPlayerError('Cannot access stream — try re-authenticating');
        return;
      }

      // Step 3: start hls.js with IPC-based loader (bypasses CORS entirely)
      logger.info('Nanit: starting hls.js with IPC loader...');

      const savedBabyToken = babyTokenRef.current;

      class NanitLoader {
        private aborted = false;
        private stats = {
          aborted: false, loaded: 0, total: 0, retry: 0, chunkCount: 0, bwEstimate: 0,
          loading: { start: 0, first: 0, end: 0 },
          parsing: { start: 0, end: 0 },
          buffering: { start: 0, first: 0, end: 0 },
        };

        load(
          context: { url: string },
          _config: unknown,
          callbacks: {
            onSuccess: (r: unknown, s: unknown, c: unknown, n: unknown) => void;
            onError: (e: unknown, c: unknown, n: unknown, s: unknown) => void;
          },
        ) {
          const url = context.url;
          const isManifest = url.includes('.m3u8');
          const headers: Record<string, string> = {
            'accept': '*/*',
            'origin': 'https://my.nanit.com',
            'referer': 'https://my.nanit.com/',
          };
          if (savedBabyToken) {
            headers['cookie'] = `baby_token=${savedBabyToken}`;
          }

          this.stats.loading.start = performance.now();

          ipcFetch(url, { headers })
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
                // Convert base64 to ArrayBuffer for binary segments
                const binary = atob(resp.body);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                this.stats.loaded = bytes.byteLength;
                callbacks.onSuccess({ data: bytes.buffer, url }, this.stats, context, null);
              }
            })
            .catch(err => {
              if (!this.aborted) {
                callbacks.onError({ code: 0, text: String(err) }, context, null, this.stats);
              }
            });
        }

        abort() { this.aborted = true; }
        destroy() { this.aborted = true; }
        getCacheAge() { return null; }
        getResponseHeader() { return null; }
      }

      const hls = new Hls({
        loader: NanitLoader as unknown as typeof Hls.prototype.config.loader,
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 3,
        liveDurationInfinity: true,
        highBufferWatchdogPeriod: 1,
        maxBufferLength: 5,
        maxMaxBufferLength: 10,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          logger.error('HLS fatal error', { type: data.type, details: data.details });
          setPlayerError(`Stream error: ${data.details}`);
        }
      });

      hls.loadSource(STREAM_URL);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
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

  if (playerError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
        <div style={{ fontSize: 12, color: 'var(--status-error, #f87171)' }}>{playerError}</div>
        <Button variant="outline" onClick={onReauth} style={{ fontSize: 12 }}>Re-authenticate</Button>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      controls
      muted
      playsInline
      style={{ width: '100%', borderRadius: 8, backgroundColor: '#000', display: 'block' }}
    />
  );
}

// ─── Main Drawer ──────────────────────────────────────────────────────────────

export default function NanitDrawer({ }: DrawerProps) {
  const [storedAuth, setStoredAuth] = usePluginStorage<StoredAuth | null>('auth_v2', null);
  const [email, setEmail] = usePluginStorage<string>('email', '');
  const [password, setPassword] = usePluginStorage<string>('password', '');

  const [authState, setAuthState] = useState<AuthState>('unauthenticated');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [pendingMfaToken, setPendingMfaToken] = useState('');

  const saveTokens = useCallback((accessToken: string, refreshToken: string) => {
    // Default 4h expiry, override from JWT if possible
    let expiry = Date.now() + 4 * 60 * 60 * 1000;
    try {
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      if (payload.exp) expiry = payload.exp * 1000;
    } catch {}
    setStoredAuth({ accessToken, refreshToken, tokenExpiry: expiry, email, password });
    setAuthState('authenticated');
  }, [email, password]);

  // On mount: check stored auth, try refresh if expired
  useEffect(() => {
    if (!storedAuth) return;
    if (storedAuth.tokenExpiry > Date.now()) {
      setAuthState('authenticated');
    } else if (storedAuth.refreshToken) {
      apiRefresh(storedAuth.refreshToken)
        .then(({ accessToken, refreshToken }) => saveTokens(accessToken, refreshToken))
        .catch(() => { setStoredAuth(null); });
    }
  }, []);

  const isTokenValid = storedAuth && storedAuth.tokenExpiry > Date.now();

  // Step 1: login → get mfa_token
  const handleLogin = useCallback(async () => {
    if (!email || !password) return;
    setErrorMsg(null);
    setAuthState('sending_mfa');

    try {
      const result = await apiLogin(email, password);
      if (result.startsWith('__direct__')) {
        // No MFA required — got tokens directly
        const parts = result.slice(10).split('__');
        saveTokens(parts[0], parts[1] || '');
      } else {
        setPendingMfaToken(result);
        setAuthState('mfa_pending');
      }
    } catch (err) {
      logger.error('Nanit login failed', { err });
      setErrorMsg(err instanceof Error ? err.message : 'Login failed');
      setAuthState('error');
    }
  }, [email, password, saveTokens]);

  // Step 2: verify MFA code
  const handleMfaVerify = useCallback(async () => {
    if (!mfaCode || !pendingMfaToken) return;
    setErrorMsg(null);
    setAuthState('mfa_verifying');

    try {
      const { accessToken, refreshToken } = await apiMfaVerify(email, password, mfaCode, pendingMfaToken);
      saveTokens(accessToken, refreshToken);
    } catch (err) {
      logger.error('Nanit MFA verify failed', { err });
      setErrorMsg(err instanceof Error ? err.message : 'MFA verification failed');
      setAuthState('error');
    }
  }, [email, password, mfaCode, pendingMfaToken, saveTokens]);

  const handleLogout = useCallback(() => {
    setStoredAuth(null);
    setAuthState('unauthenticated');
    setMfaCode('');
    setErrorMsg(null);
  }, []);

  const isBusy = authState === 'sending_mfa' || authState === 'mfa_verifying';

  return (
    <>
      <DrawerHeaderTitle>Nanit Camera</DrawerHeaderTitle>

      <DrawerHeaderActions>
        <button
          onClick={handleLogout}
          style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
        >
          Sign out
        </button>
      </DrawerHeaderActions>

      <div style={{ padding: 16 }}>
        {/* Authenticated: show stream */}
        {isTokenValid && (
          <HlsPlayer accessToken={storedAuth.accessToken} onReauth={handleLogout} />
        )}

        {/* Login form */}
        {!isTokenValid && authState !== 'mfa_pending' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              Sign in to Nanit
            </div>

            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isBusy} />
            <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={isBusy} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />

            <Button onClick={handleLogin} disabled={isBusy || !email || !password}>
              {authState === 'sending_mfa' ? 'Signing in...' : 'Sign in'}
            </Button>

            {errorMsg && (
              <div style={{ fontSize: 12, color: 'var(--status-error, #f87171)', marginTop: 4 }}>{errorMsg}</div>
            )}
          </div>
        )}

        {/* MFA code entry */}
        {!isTokenValid && authState === 'mfa_pending' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>Enter your MFA code</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Check your email for the code</div>

            <Input
              type="text"
              placeholder="1234"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={authState === 'mfa_verifying'}
              onKeyDown={(e) => e.key === 'Enter' && handleMfaVerify()}
              style={{ letterSpacing: '0.2em', fontSize: 20, textAlign: 'center' }}
            />

            <Button onClick={handleMfaVerify} disabled={mfaCode.length < 4 || authState === 'mfa_verifying'}>
              {authState === 'mfa_verifying' ? 'Verifying...' : 'Verify'}
            </Button>

            <button
              onClick={() => { setMfaCode(''); setErrorMsg(null); setAuthState('unauthenticated'); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Back to login
            </button>

            {errorMsg && (
              <div style={{ fontSize: 12, color: 'var(--status-error, #f87171)' }}>{errorMsg}</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
