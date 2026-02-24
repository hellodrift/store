import { useState, useEffect, useRef, useCallback } from 'react';
import { DrawerHeaderTitle, DrawerHeaderActions } from '@drift/design/components';
import { Button, Input } from '@drift/design/primitives';
import { usePluginStorage, logger } from '@drift/plugin-api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BridgeConfig {
  apiUrl: string;
}

interface DrawerProps {
  payload: { view?: string; cameraName?: string; cameraNickname?: string; [key: string]: unknown };
  drawer: {
    close: () => void;
    open: (payload: Record<string, unknown>) => void;
    push: (payload: Record<string, unknown>) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

interface CameraDetail {
  name_uri: string;
  nickname: string;
  online?: boolean;
  model_name?: string;
  model?: string;
  firmware_ver?: string;
  ip?: string;
  mac?: string;
  is_pan?: boolean;
  thumbnail?: string;
  [key: string]: unknown;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  marginBottom: 8, marginTop: 16,
};

const metaRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '4px 0', fontSize: 12,
};

const metaLabel: React.CSSProperties = { color: 'var(--text-muted)' };
const metaValue: React.CSSProperties = { color: 'var(--text-primary)', textAlign: 'right' as const };

const controlRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0',
};

// ─── IPC Fetch Helper ────────────────────────────────────────────────────────
// All HTTP requests go through Electron's main process via IPC to bypass CORS.
// This is the same pattern used by the nanit plugin.

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

// Helper to decode base64 IPC response body to text
function decodeBody(body: string): string {
  try {
    return atob(body);
  } catch {
    return body;
  }
}

// Helper to decode base64 IPC response body to JSON
function decodeJson(body: string): any {
  return JSON.parse(decodeBody(body));
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch(config: BridgeConfig, path: string): Promise<any> {
  const resp = await ipcFetch(`${config.apiUrl}${path}`);
  if (!resp.ok) throw new Error(`API ${resp.status}: ${resp.statusText}`);
  return decodeJson(resp.body);
}

async function apiCommand(config: BridgeConfig, cam: string, cmd: string, value?: string): Promise<any> {
  const path = value !== undefined ? `/api/${cam}/${cmd}?value=${value}` : `/api/${cam}/${cmd}`;
  return apiFetch(config, path);
}

// Simple fetch wrapper for setup wizard (before config is saved)
async function simpleFetch(url: string): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  try {
    const resp = await ipcFetch(url);
    if (!resp.ok) return { ok: false, status: resp.status, error: `HTTP ${resp.status}` };
    return { ok: true, status: resp.status, data: decodeJson(resp.body) };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}

// ─── WebRTC Video Player ─────────────────────────────────────────────────────
// Uses Wyze's AWS Kinesis Video Streams WebRTC signaling for live video.
// The video goes directly from camera → AWS cloud → browser (no TUTK/P2P needed).

interface SignalingData {
  result: string;
  cam: string;
  ClientId: string;
  signalingUrl: string;
  servers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}

function WebRtcPlayer({ config, cameraName, thumbnailUrl }: { config: BridgeConfig; cameraName: string; thumbnailUrl?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  const [connectionState, setConnectionState] = useState<string>('new');

  // Track loading elapsed time for display
  useEffect(() => {
    if (!isLoading) { setLoadingElapsed(0); return; }
    setLoadingElapsed(0);
    const start = Date.now();
    const timer = setInterval(() => {
      setLoadingElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isLoading, retryCount]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    setPlayerError(null);
    setErrorDetail(null);
    setIsLoading(true);
    setConnectionState('new');

    const connect = async () => {
      try {
        // 1. Get WebRTC signaling data from our server
        logger.info('WebRTC: fetching signaling', { cam: cameraName });
        const sigResp = await ipcFetch(`${config.apiUrl}/signaling/${cameraName}`);
        if (!sigResp.ok) throw new Error(`Signaling failed: ${sigResp.status}`);
        const signal: SignalingData = decodeJson(sigResp.body);

        if (signal.result !== 'ok') {
          throw new Error(signal.result || 'Signaling failed');
        }

        if (cancelled) return;

        // 2. Connect WebSocket to AWS Kinesis for signaling
        logger.info('WebRTC: connecting to Kinesis', { url: signal.signalingUrl.substring(0, 80) });
        setConnectionState('signaling');
        const ws = new WebSocket(signal.signalingUrl);
        wsRef.current = ws;

        // 3. Create RTCPeerConnection with TURN/STUN servers
        const iceServers = signal.servers.map(s => ({
          urls: s.urls,
          username: s.username || undefined,
          credential: s.credential || undefined,
        }));
        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;

        // ICE candidate buffering — queue candidates until remote description is set
        let remoteDescriptionSet = false;
        let pendingCandidates: RTCIceCandidateInit[] = [];

        const flushPendingCandidates = async () => {
          remoteDescriptionSet = true;
          for (const candidate of pendingCandidates) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              logger.error('WebRTC: failed to add buffered ICE candidate', { err: String(err) });
            }
          }
          pendingCandidates = [];
        };

        // Add transceivers for video and audio
        // Use sendrecv to be compatible with camera's SDP answer directions
        pc.addTransceiver('video', { direction: 'sendrecv' });
        pc.addTransceiver('audio', { direction: 'sendrecv' });

        // Handle incoming tracks
        pc.ontrack = (evt) => {
          logger.info('WebRTC: received track', { kind: evt.track.kind });
          if (evt.streams[0]) {
            video.srcObject = evt.streams[0];
            video.play().catch(() => {});
          }
        };

        // Monitor ICE connection state
        pc.oniceconnectionstatechange = () => {
          const state = pc.iceConnectionState;
          logger.info('WebRTC: ICE state', { state });
          setConnectionState(state);
          if (state === 'connected' || state === 'completed') {
            setIsLoading(false);
          } else if (state === 'failed') {
            if (!cancelled) {
              setPlayerError('ICE connection failed');
              setErrorDetail('Could not establish a direct connection to the camera through the cloud relay. The camera may be offline or unreachable.');
              setIsLoading(false);
            }
          } else if (state === 'disconnected') {
            // disconnected can be transient — wait briefly before declaring failure
            setTimeout(() => {
              if (pc.iceConnectionState === 'disconnected' && !cancelled) {
                setPlayerError('Stream disconnected');
                setErrorDetail('The WebRTC connection was lost. Try reconnecting.');
                setIsLoading(false);
              }
            }, 5000);
          }
        };

        // Send ICE candidates to camera via WebSocket
        // Following docker-wyze-bridge pattern: send full candidate, include recipientClientId
        pc.onicecandidate = (evt) => {
          if (evt.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              action: 'ICE_CANDIDATE',
              messagePayload: btoa(JSON.stringify(evt.candidate)),
              recipientClientId: signal.ClientId,
            }));
          }
        };

        // WebSocket message handling
        ws.onmessage = async (msg) => {
          if (!msg.data) return;
          try {
            const eventData = JSON.parse(msg.data);
            if (!eventData.messagePayload) return;
            const payload = JSON.parse(atob(eventData.messagePayload));

            switch (eventData.messageType) {
              case 'SDP_OFFER':
              case 'SDP_ANSWER':
                logger.info('WebRTC: received remote SDP', { type: eventData.messageType });
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
                await flushPendingCandidates();
                break;
              case 'ICE_CANDIDATE':
                if (payload.candidate) {
                  if (remoteDescriptionSet) {
                    await pc.addIceCandidate(new RTCIceCandidate(payload));
                  } else {
                    logger.info('WebRTC: buffering ICE candidate (remote desc not set yet)');
                    pendingCandidates.push(payload);
                  }
                }
                break;
              case 'STATUS_RESPONSE':
                logger.info('WebRTC: status response', { payload: eventData.statusResponse || payload });
                break;
            }
          } catch (err) {
            logger.error('WebRTC: message parse error', { err: String(err) });
          }
        };

        ws.onerror = (err) => {
          logger.error('WebRTC: WebSocket error', { err: String(err) });
          if (!cancelled) {
            setPlayerError('WebSocket connection error');
            setErrorDetail('Failed to connect to the signaling server.');
            setIsLoading(false);
          }
        };

        ws.onclose = (evt) => {
          logger.info('WebRTC: WebSocket closed', { code: evt.code, reason: evt.reason });
        };

        // When WebSocket opens, create and send SDP offer
        ws.onopen = async () => {
          if (cancelled) return;
          setConnectionState('negotiating');
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            // Following docker-wyze-bridge: VIEWER sends SDP_OFFER with recipientClientId
            ws.send(JSON.stringify({
              action: 'SDP_OFFER',
              messagePayload: btoa(JSON.stringify({
                sdp: offer.sdp,
                type: offer.type,
              })),
              recipientClientId: signal.ClientId,
            }));
            logger.info('WebRTC: sent SDP offer');

            // ICE connection timeout
            setTimeout(() => {
              if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed' && !cancelled) {
                setPlayerError('Connection timed out');
                setErrorDetail('Could not establish a connection to the camera. The camera may be offline or the signaling session may have expired.');
                setIsLoading(false);
              }
            }, 30000);
          } catch (err) {
            logger.error('WebRTC: offer creation failed', { err: String(err) });
            if (!cancelled) {
              setPlayerError('Failed to create WebRTC offer');
              setIsLoading(false);
            }
          }
        };

      } catch (err) {
        if (!cancelled) {
          logger.error('WebRTC: setup failed', { err: String(err) });
          setPlayerError('WebRTC setup failed');
          setErrorDetail(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [config, cameraName, retryCount]);

  if (playerError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'center' }}>
        {thumbnailUrl && (
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
            <img src={thumbnailUrl} alt="Last known view" style={{ width: '100%', display: 'block', opacity: 0.6 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.4)',
            }}>
              <span style={{ color: '#f87171', fontSize: 13, fontWeight: 600 }}>Offline</span>
            </div>
          </div>
        )}
        <div style={{ padding: '8px 16px' }}>
          <div style={{ fontSize: 12, color: '#f87171', marginBottom: 4 }}>{playerError}</div>
          {errorDetail && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>{errorDetail}</div>
          )}
          <Button variant="outline" onClick={() => { setPlayerError(null); setRetryCount(c => c + 1); }} style={{ fontSize: 12 }}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', overflow: 'hidden', borderRadius: 8, backgroundColor: '#000' }}>
      {isLoading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          backgroundColor: '#000', zIndex: 1, gap: 8,
        }}>
          {thumbnailUrl && (
            <img src={thumbnailUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.2 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
          <div style={{ color: 'var(--text-muted)', fontSize: 12, zIndex: 1 }}>
            {connectionState === 'new' ? 'Getting signaling data...' :
             connectionState === 'signaling' ? 'Connecting to camera...' :
             connectionState === 'negotiating' ? 'Establishing video stream...' :
             connectionState === 'checking' ? 'Setting up connection...' :
             'Connecting...'}
          </div>
          {loadingElapsed > 5 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 10, zIndex: 1, opacity: 0.6 }}>{loadingElapsed}s elapsed</div>
          )}
        </div>
      )}
      <video ref={videoRef} controls muted autoPlay playsInline
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
    </div>
  );
}

// ─── Camera Controls ─────────────────────────────────────────────────────────

function CameraControls({ config, cameraName, detail }: { config: BridgeConfig; cameraName: string; detail: CameraDetail }) {
  const [nightVision, setNightVision] = useState<number | null>(detail.night_vision ?? null);
  const [statusLight, setStatusLight] = useState<number | null>(detail.status_light ?? null);
  const [motionDetection, setMotionDetection] = useState<number | null>(detail.motion_detection ?? null);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = useCallback(async (cmd: string, currentVal: number | null, setter: (v: number) => void) => {
    setBusy(cmd);
    try {
      const newVal = currentVal === 1 ? 2 : 1;
      await apiCommand(config, cameraName, cmd, String(newVal));
      setter(newVal);
    } catch (err) {
      logger.error(`Failed to toggle ${cmd}`, { err: String(err) });
    } finally {
      setBusy(null);
    }
  }, [config, cameraName]);

  const nightVisionCycle = useCallback(async () => {
    setBusy('night_vision');
    try {
      const next = nightVision === 1 ? 2 : nightVision === 2 ? 3 : 1;
      await apiCommand(config, cameraName, 'night_vision', String(next));
      setNightVision(next);
    } catch (err) {
      logger.error('Failed to toggle night vision', { err: String(err) });
    } finally {
      setBusy(null);
    }
  }, [config, cameraName, nightVision]);

  const nightVisionLabel = nightVision === 1 ? 'On' : nightVision === 2 ? 'Off' : nightVision === 3 ? 'Auto' : '...';

  const isPanCam = detail.is_pan === true ||
    detail.model_name?.toLowerCase().includes('pan');

  return (
    <div>
      <div style={sectionTitle}>Controls</div>

      <div style={controlRow}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Night Vision</span>
        <Button
          variant="outline"
          onClick={nightVisionCycle}
          disabled={busy === 'night_vision'}
          style={{ fontSize: 11, padding: '2px 8px', minWidth: 48 }}
        >
          {busy === 'night_vision' ? '...' : nightVisionLabel}
        </Button>
      </div>

      <div style={controlRow}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Status Light</span>
        <Button
          variant="outline"
          onClick={() => toggle('status_light', statusLight, setStatusLight)}
          disabled={busy === 'status_light'}
          style={{ fontSize: 11, padding: '2px 8px', minWidth: 48 }}
        >
          {busy === 'status_light' ? '...' : statusLight === 1 ? 'On' : 'Off'}
        </Button>
      </div>

      <div style={controlRow}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Motion Detection</span>
        <Button
          variant="outline"
          onClick={() => toggle('motion_detection', motionDetection, setMotionDetection)}
          disabled={busy === 'motion_detection'}
          style={{ fontSize: 11, padding: '2px 8px', minWidth: 48 }}
        >
          {busy === 'motion_detection' ? '...' : motionDetection === 1 ? 'On' : 'Off'}
        </Button>
      </div>

      {isPanCam && (
        <>
          <div style={{ ...sectionTitle, marginTop: 20 }}>Pan / Tilt</div>
          <PtzControls config={config} cameraName={cameraName} />
        </>
      )}
    </div>
  );
}

// ─── PTZ Controls ────────────────────────────────────────────────────────────

function PtzControls({ config, cameraName }: { config: BridgeConfig; cameraName: string }) {
  const [busy, setBusy] = useState(false);

  const move = useCallback(async (direction: string) => {
    setBusy(true);
    try {
      await apiCommand(config, cameraName, 'rotary_degree', direction);
    } catch (err) {
      logger.error('PTZ move failed', { err: String(err), direction });
    } finally {
      setBusy(false);
    }
  }, [config, cameraName]);

  const resetPosition = useCallback(async () => {
    setBusy(true);
    try {
      await apiCommand(config, cameraName, 'reset_rotation');
    } catch (err) {
      logger.error('PTZ reset failed', { err: String(err) });
    } finally {
      setBusy(false);
    }
  }, [config, cameraName]);

  const btnStyle: React.CSSProperties = {
    fontSize: 16, padding: '6px 12px', minWidth: 40,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '4px 0' }}>
      <Button variant="outline" onClick={() => move('up')} disabled={busy} style={btnStyle}>
        &#x25B2;
      </Button>
      <div style={{ display: 'flex', gap: 4 }}>
        <Button variant="outline" onClick={() => move('left')} disabled={busy} style={btnStyle}>
          &#x25C0;
        </Button>
        <Button variant="outline" onClick={resetPosition} disabled={busy} style={{ ...btnStyle, fontSize: 10 }}>
          &#x25CB;
        </Button>
        <Button variant="outline" onClick={() => move('right')} disabled={busy} style={btnStyle}>
          &#x25B6;
        </Button>
      </div>
      <Button variant="outline" onClick={() => move('down')} disabled={busy} style={btnStyle}>
        &#x25BC;
      </Button>
    </div>
  );
}

// ─── Shared Styles ───────────────────────────────────────────────────────────

const fieldLabel: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4,
};

const stepDot = (active: boolean, done: boolean): React.CSSProperties => ({
  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 11, fontWeight: 600, flexShrink: 0,
  backgroundColor: done ? '#22c55e' : active ? 'var(--brand-primary)' : 'var(--surface-elevated)',
  color: done || active ? '#fff' : 'var(--text-muted)',
});

const statusBox = (ok: boolean): React.CSSProperties => ({
  fontSize: 12, padding: '8px 12px', borderRadius: 6,
  backgroundColor: ok ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
  color: ok ? '#22c55e' : '#ef4444',
});

// ─── Setup Wizard ────────────────────────────────────────────────────────────

type SetupStep = 'credentials' | 'server' | 'connect' | 'done';

interface WyzeCredentials {
  email: string;
  password: string;
  apiId: string;
  apiKey: string;
}

function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [, setBridgeConfig] = usePluginStorage<BridgeConfig | null>('bridgeConfig', null);
  const [savedCreds, setSavedCreds] = usePluginStorage<WyzeCredentials | null>('wyzeCreds', null);

  const [step, setStep] = useState<SetupStep>(savedCreds ? 'server' : 'credentials');

  // Step 1: Wyze credentials
  const [email, setEmail] = useState(savedCreds?.email || '');
  const [password, setPassword] = useState(savedCreds?.password || '');
  const [apiId, setApiId] = useState(savedCreds?.apiId || '');
  const [apiKey, setApiKey] = useState(savedCreds?.apiKey || '');

  // Step 2: Server
  const [serverStatus, setServerStatus] = useState<'idle' | 'checking' | 'running' | 'error'>('idle');
  const [serverMsg, setServerMsg] = useState('');

  // Step 3: Connection (port 5050 to avoid macOS AirPlay on 5000)
  const [bridgeUrl, setBridgeUrl] = useState('http://localhost:5050');
  const [connectStatus, setConnectStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [connecting, setConnecting] = useState(false);

  const steps: { key: SetupStep; label: string }[] = [
    { key: 'credentials', label: 'Wyze Credentials' },
    { key: 'server', label: 'Start Server' },
    { key: 'connect', label: 'Connect' },
  ];

  const currentIdx = steps.findIndex(s => s.key === step);

  // ── Step 1: Save credentials ──
  const saveCredentials = useCallback(() => {
    setSavedCreds({ email, password, apiId, apiKey });
    setStep('server');
  }, [email, password, apiId, apiKey, setSavedCreds]);

  // ── Step 2: Server check ──
  const checkServer = useCallback(async () => {
    setServerStatus('checking');
    setServerMsg('');
    try {
      const result = await simpleFetch(`${bridgeUrl}/api`);
      if (result.ok) {
        setServerStatus('running');
        setServerMsg('Server is already running!');
        return;
      }
      setServerStatus('idle');
      setServerMsg('Server not detected. Start it with the command below.');
    } catch {
      setServerStatus('idle');
      setServerMsg('Server not detected.');
    }
  }, [bridgeUrl]);

  useEffect(() => {
    if (step === 'server') checkServer();
  }, [step]);

  // ── Step 3: Auto-connect ──
  const autoConnect = useCallback(async () => {
    setConnecting(true);
    setConnectStatus(null);
    try {
      const result = await simpleFetch(`${bridgeUrl}/api`);
      if (!result.ok) throw new Error(result.error || `HTTP ${result.status}`);
      const data = result.data;
      // Our Python server returns an array of cameras
      const camCount = Array.isArray(data) ? data.length :
        typeof data === 'object' ? Object.keys(data).filter(k => typeof data[k] === 'object').length : 0;

      setBridgeConfig({ apiUrl: bridgeUrl.replace(/\/$/, '') });
      setConnectStatus({ ok: true, message: `Connected! Found ${camCount} camera${camCount !== 1 ? 's' : ''}.` });
      setStep('done');
    } catch (err) {
      setConnectStatus({ ok: false, message: err instanceof Error ? err.message : 'Connection failed' });
    } finally {
      setConnecting(false);
    }
  }, [bridgeUrl, setBridgeConfig, onComplete]);

  const creds = savedCreds || { email, password, apiId, apiKey };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        {steps.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < steps.length - 1 ? 1 : undefined }}>
            <div style={stepDot(s.key === step, i < currentIdx)}>
              {i < currentIdx ? '\u2713' : i + 1}
            </div>
            <span style={{ fontSize: 11, color: s.key === step ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 1, backgroundColor: 'var(--border-muted)' }} />
            )}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Credentials ── */}
      {step === 'credentials' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Wyze Account Credentials
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Enter your Wyze account email and password. Then get your API credentials from{' '}
            <a
              href="https://developer-api-console.wyze.com/#/apikey/view"
              target="_blank"
              rel="noopener"
              style={{ color: 'var(--brand-primary)' }}
            >
              Wyze Developer Console
            </a>.
          </div>

          <div>
            <label style={fieldLabel}>Wyze Email</label>
            <Input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label style={fieldLabel}>Wyze Password</label>
            <Input type="password" placeholder="Your Wyze password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>

          <div style={{ borderTop: '1px solid var(--border-muted)', paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Get these from the Wyze Developer Console (link above):
            </div>
          </div>

          <div>
            <label style={fieldLabel}>Key ID</label>
            <Input type="text" placeholder="Paste your Key ID" value={apiId} onChange={e => setApiId(e.target.value)} />
          </div>
          <div>
            <label style={fieldLabel}>API Key</label>
            <Input type="password" placeholder="Paste your API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} />
          </div>

          <Button onClick={saveCredentials} disabled={!email || !password || !apiId || !apiKey}>
            Next: Start Server
          </Button>
        </div>
      )}

      {/* ── STEP 2: Start Server ── */}
      {step === 'server' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Start Wyze Server
          </div>

          {serverStatus === 'running' ? (
            <>
              <div style={statusBox(true)}>{serverMsg}</div>
              <Button onClick={() => setStep('connect')}>
                Next: Connect
              </Button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Run the Wyze camera server. It connects to Wyze's cloud API for camera info, controls, and live video via WebRTC.
              </div>

              <div style={{
                fontSize: 11, fontFamily: 'monospace', padding: 12, borderRadius: 6,
                backgroundColor: 'var(--surface-elevated)', color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5,
                border: '1px solid var(--border-muted)', position: 'relative',
              }}>
                {`WYZE_EMAIL="${creds.email}" \\
WYZE_PASSWORD="${creds.password}" \\
API_ID="${creds.apiId}" \\
API_KEY="${creds.apiKey}" \\
python3 wyze_server.py`}
                <button
                  onClick={() => {
                    const cmd = `WYZE_EMAIL="${creds.email}" WYZE_PASSWORD="${creds.password}" API_ID="${creds.apiId}" API_KEY="${creds.apiKey}" python3 wyze_server.py`;
                    navigator.clipboard.writeText(cmd);
                  }}
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    fontSize: 10, padding: '2px 6px', borderRadius: 3,
                    background: 'var(--surface-page)', border: '1px solid var(--border-muted)',
                    color: 'var(--text-muted)', cursor: 'pointer',
                  }}
                >
                  Copy
                </button>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                The server needs <code>flask</code>, <code>flask-cors</code>, and <code>requests</code> Python packages.
                Install with: <code>pip install flask flask-cors requests</code>
              </div>

              {serverMsg && (
                <div style={statusBox(serverStatus === 'running')}>
                  {serverMsg}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="outline" onClick={() => setStep('credentials')} style={{ flex: 1 }}>
                  Back
                </Button>
                <Button variant="outline" onClick={checkServer} style={{ flex: 1 }}>
                  Check Connection
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── STEP 3: Connect ── */}
      {step === 'connect' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Connect to Server
          </div>

          <div>
            <label style={fieldLabel}>Server URL</label>
            <Input type="url" placeholder="http://localhost:5050" value={bridgeUrl} onChange={e => setBridgeUrl(e.target.value)} />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              Change this if the server is running on another machine on your network.
            </div>
          </div>

          {connectStatus && <div style={statusBox(connectStatus.ok)}>{connectStatus.message}</div>}

          <Button onClick={autoConnect} disabled={connecting || !bridgeUrl}>
            {connecting ? 'Connecting...' : 'Connect & Finish Setup'}
          </Button>

          <Button variant="outline" onClick={() => setStep('server')}>
            Back
          </Button>
        </div>
      )}

      {/* ── DONE ── */}
      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>&#x2705;</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            Setup Complete!
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
            Your cameras should now appear in the sidebar. Click a camera to view the live stream.
          </div>
          <Button onClick={onComplete}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Settings View (for reconfiguration) ─────────────────────────────────────

function SettingsView({ onSaved }: { onSaved: () => void }) {
  const [bridgeConfig, setBridgeConfig] = usePluginStorage<BridgeConfig | null>('bridgeConfig', null);
  const [savedCreds, setSavedCreds] = usePluginStorage<WyzeCredentials | null>('wyzeCreds', null);

  // If no bridge config, show the setup wizard
  if (!bridgeConfig) {
    return <SetupWizard onComplete={onSaved} />;
  }

  // Otherwise show the connected state with reconfigure options
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const testConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await simpleFetch(`${bridgeConfig.apiUrl}/api`);
      if (!result.ok) throw new Error(result.error || `HTTP ${result.status}`);
      const camCount = Array.isArray(result.data) ? result.data.length : 0;
      setTestResult({ ok: true, message: `Connected! ${camCount} camera${camCount !== 1 ? 's' : ''} found.` });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Connection failed' });
    } finally {
      setTesting(false);
    }
  }, [bridgeConfig]);

  const disconnect = useCallback(() => {
    setBridgeConfig(null);
    setSavedCreds(null);
  }, [setBridgeConfig, setSavedCreds]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
        Server Connected
      </div>

      <div style={metaRow}>
        <span style={metaLabel}>Server URL</span>
        <span style={{ ...metaValue, fontSize: 11, fontFamily: 'monospace' }}>{bridgeConfig.apiUrl}</span>
      </div>
      {savedCreds && (
        <div style={metaRow}>
          <span style={metaLabel}>Wyze Account</span>
          <span style={metaValue}>{savedCreds.email}</span>
        </div>
      )}

      {testResult && <div style={statusBox(testResult.ok)}>{testResult.message}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="outline" onClick={testConnection} disabled={testing} style={{ flex: 1 }}>
          {testing ? 'Testing...' : 'Test Connection'}
        </Button>
      </div>

      <button
        onClick={disconnect}
        style={{
          background: 'none', border: 'none', fontSize: 11,
          color: '#ef4444', cursor: 'pointer', textDecoration: 'underline',
          textAlign: 'center', padding: '8px 0', marginTop: 8,
        }}
      >
        Disconnect & Reconfigure
      </button>
    </div>
  );
}

// ─── Camera View ─────────────────────────────────────────────────────────────

function CameraView({ config, cameraName, cameraNickname }: { config: BridgeConfig; cameraName: string; cameraNickname: string }) {
  const [detail, setDetail] = useState<CameraDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [streamActive, setStreamActive] = useState(true);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    apiFetch(config, `/api/${cameraName}`)
      .then(data => { if (!cancelled) setDetail(data); })
      .catch(err => logger.error('Failed to fetch camera detail', { err: String(err), cam: cameraName }))
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [config, cameraName]);

  const restartStream = useCallback(async () => {
    setRestarting(true);
    try {
      await apiCommand(config, cameraName, 'start');
      setStreamActive(false);
      setTimeout(() => setStreamActive(true), 2000);
    } catch (err) {
      logger.error('Failed to restart stream', { err: String(err) });
    } finally {
      setRestarting(false);
    }
  }, [config, cameraName]);


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Live Video */}
      {streamActive ? (
        <WebRtcPlayer config={config} cameraName={cameraName} thumbnailUrl={detail?.thumbnail ? `${config.apiUrl}/thumb/${cameraName}` : undefined} />
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 200, borderRadius: 8, backgroundColor: '#000',
        }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Restarting stream...</div>
        </div>
      )}

      {/* Quick Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="outline" onClick={restartStream} disabled={restarting} style={{ flex: 1, fontSize: 12 }}>
          {restarting ? 'Restarting...' : 'Restart Stream'}
        </Button>
      </div>

      {/* Camera Info */}
      {detail && (
        <div>
          <div style={sectionTitle}>Camera Info</div>
          <div style={metaRow}>
            <span style={metaLabel}>Name</span>
            <span style={metaValue}>{detail.nickname || cameraNickname}</span>
          </div>
          {detail.model_name && (
            <div style={metaRow}>
              <span style={metaLabel}>Model</span>
              <span style={metaValue}>{detail.model_name}</span>
            </div>
          )}
          {detail.firmware_ver && (
            <div style={metaRow}>
              <span style={metaLabel}>Firmware</span>
              <span style={metaValue}>{detail.firmware_ver}</span>
            </div>
          )}
          {detail.ip && (
            <div style={metaRow}>
              <span style={metaLabel}>IP</span>
              <span style={metaValue}>{detail.ip}</span>
            </div>
          )}
          {detail.mac && (
            <div style={metaRow}>
              <span style={metaLabel}>MAC</span>
              <span style={metaValue}>{detail.mac}</span>
            </div>
          )}
          <div style={metaRow}>
            <span style={metaLabel}>Status</span>
            <span style={{
              fontSize: 11, padding: '1px 6px', borderRadius: 4,
              backgroundColor: detail.online ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: detail.online ? '#22c55e' : '#ef4444',
            }}>
              {detail.online ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      )}

      {/* Controls */}
      {detail && <CameraControls config={config} cameraName={cameraName} detail={detail} />}

      {loading && !detail && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 16 }}>
          Loading camera info...
        </div>
      )}
    </div>
  );
}

// ─── Main Drawer ─────────────────────────────────────────────────────────────

export default function WyzeCameraDrawer({ payload, drawer }: DrawerProps) {
  const { view = 'settings', cameraName, cameraNickname } = payload;
  const [bridgeConfig] = usePluginStorage<BridgeConfig | null>('bridgeConfig', null);

  const effectiveView = (!bridgeConfig && view === 'camera') ? 'settings' : view;

  const title = effectiveView === 'settings'
    ? 'Wyze Camera Settings'
    : cameraNickname || cameraName || 'Wyze Camera';

  return (
    <>
      <DrawerHeaderTitle>{String(title)}</DrawerHeaderTitle>

      <DrawerHeaderActions>
        {effectiveView === 'camera' && (
          <button
            onClick={() => drawer.open({ view: 'settings' })}
            style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
          >
            Settings
          </button>
        )}
      </DrawerHeaderActions>

      <div style={{ padding: 16 }}>
        {effectiveView === 'settings' && (
          <SettingsView onSaved={() => {
            if (cameraName) {
              drawer.open({ view: 'camera', cameraName, cameraNickname });
            } else {
              drawer.close();
            }
          }} />
        )}

        {effectiveView === 'camera' && bridgeConfig && cameraName && (
          <CameraView
            config={bridgeConfig}
            cameraName={String(cameraName)}
            cameraNickname={String(cameraNickname || cameraName)}
          />
        )}
      </div>
    </>
  );
}
