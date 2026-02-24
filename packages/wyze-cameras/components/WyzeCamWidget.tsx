/**
 * Wyze Camera Widget
 *
 * entity-widget canvas for wyze_cam entities.
 * Renders in two modes:
 * - compact: inline chip with camera emoji + name
 * - full card: auto-playing WebRTC live stream with camera info bar
 *
 * Clicking the card opens the entity-drawer (WyzeCamEntityDrawer).
 */

import { useState, useEffect, useRef } from 'react';
import { usePluginStorage, logger } from '@drift/plugin-api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BridgeConfig {
  apiUrl: string;
}

interface WidgetProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  compact: boolean;
  messageId: string;
}

interface SignalingData {
  result: string;
  cam: string;
  ClientId: string;
  signalingUrl: string;
  servers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}

// ─── IPC Fetch ────────────────────────────────────────────────────────────────

async function ipcFetch(url: string): Promise<{
  ok: boolean; status: number; body: string;
}> {
  // @ts-ignore window.electron exists in Drift's preload
  return window.electron.invoke('drift:fetch', { url, method: 'GET' });
}

// ─── Chip (compact) ──────────────────────────────────────────────────────────

function CamChip({ label }: { label?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '2px 8px', borderRadius: '4px',
      background: '#FFDA27', color: '#000',
      fontSize: '12px', fontWeight: 500,
    }}>
      <span style={{ fontSize: 11 }}>📷</span>
      {label ?? 'Wyze Cam'}
    </span>
  );
}

// ─── Stream Card (auto-play WebRTC) ──────────────────────────────────────────

function StreamCard({ bridgeUrl, cameraNameUri }: { bridgeUrl: string; cameraNameUri: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionState, setConnectionState] = useState<string>('new');
  const [nickname, setNickname] = useState(cameraNameUri);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    setError(null);
    setLoading(true);
    setConnectionState('new');

    const connect = async () => {
      // Fetch camera info for nickname
      try {
        const infoResp = await ipcFetch(`${bridgeUrl}/api/${cameraNameUri}`);
        if (infoResp.ok && !cancelled) {
          const data = JSON.parse(atob(infoResp.body));
          if (data.nickname) setNickname(data.nickname);
        }
      } catch {}

      try {
        const sigResp = await ipcFetch(`${bridgeUrl}/signaling/${cameraNameUri}`);
        if (!sigResp.ok) throw new Error(`Signaling failed: ${sigResp.status}`);
        const signal: SignalingData = JSON.parse(atob(sigResp.body));

        if (signal.result !== 'ok') throw new Error(signal.result || 'Signaling failed');
        if (cancelled) return;

        setConnectionState('signaling');
        const ws = new WebSocket(signal.signalingUrl);
        wsRef.current = ws;

        const iceServers = signal.servers.map(s => ({
          urls: s.urls,
          username: s.username || undefined,
          credential: s.credential || undefined,
        }));
        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;

        let remoteDescriptionSet = false;
        let pendingCandidates: RTCIceCandidateInit[] = [];

        const flushPendingCandidates = async () => {
          remoteDescriptionSet = true;
          for (const candidate of pendingCandidates) {
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
          }
          pendingCandidates = [];
        };

        pc.addTransceiver('video', { direction: 'sendrecv' });
        pc.addTransceiver('audio', { direction: 'sendrecv' });

        pc.ontrack = (evt) => {
          if (evt.streams[0]) {
            video.srcObject = evt.streams[0];
            video.play().catch(() => {});
          }
        };

        pc.oniceconnectionstatechange = () => {
          const state = pc.iceConnectionState;
          setConnectionState(state);
          if (state === 'connected' || state === 'completed') {
            setLoading(false);
          } else if (state === 'failed') {
            if (!cancelled) { setError('Connection failed'); setLoading(false); }
          } else if (state === 'disconnected') {
            setTimeout(() => {
              if (pc.iceConnectionState === 'disconnected' && !cancelled) {
                setError('Stream disconnected');
                setLoading(false);
              }
            }, 5000);
          }
        };

        pc.onicecandidate = (evt) => {
          if (evt.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              action: 'ICE_CANDIDATE',
              messagePayload: btoa(JSON.stringify(evt.candidate)),
              recipientClientId: signal.ClientId,
            }));
          }
        };

        ws.onmessage = async (msg) => {
          if (!msg.data) return;
          try {
            const eventData = JSON.parse(msg.data);
            if (!eventData.messagePayload) return;
            const payload = JSON.parse(atob(eventData.messagePayload));

            switch (eventData.messageType) {
              case 'SDP_OFFER':
              case 'SDP_ANSWER':
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
                await flushPendingCandidates();
                break;
              case 'ICE_CANDIDATE':
                if (payload.candidate) {
                  if (remoteDescriptionSet) {
                    await pc.addIceCandidate(new RTCIceCandidate(payload));
                  } else {
                    pendingCandidates.push(payload);
                  }
                }
                break;
            }
          } catch (err) {
            logger.error('Wyze widget: WebRTC message error', { err: String(err) });
          }
        };

        ws.onerror = () => {
          if (!cancelled) { setError('Signaling error'); setLoading(false); }
        };

        ws.onopen = async () => {
          if (cancelled) return;
          setConnectionState('negotiating');
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws.send(JSON.stringify({
              action: 'SDP_OFFER',
              messagePayload: btoa(JSON.stringify({ sdp: offer.sdp, type: offer.type })),
              recipientClientId: signal.ClientId,
            }));

            setTimeout(() => {
              if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed' && !cancelled) {
                setError('Connection timed out');
                setLoading(false);
              }
            }, 30000);
          } catch {
            if (!cancelled) { setError('WebRTC setup failed'); setLoading(false); }
          }
        };

      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Connection failed');
          setLoading(false);
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
  }, [bridgeUrl, cameraNameUri]);

  if (error) {
    return (
      <div style={{
        borderRadius: '10px',
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        padding: '24px 16px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>📷</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          {nickname}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{error}</div>
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
      <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', overflow: 'hidden' }}>
        {loading && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#000', zIndex: 1,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
              {connectionState === 'new' ? 'Connecting...' :
               connectionState === 'signaling' ? 'Connecting to camera...' :
               connectionState === 'negotiating' ? 'Establishing stream...' :
               'Connecting...'}
            </div>
          </div>
        )}
        <video ref={videoRef} muted autoPlay playsInline
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
      <div style={{
        padding: '10px 14px',
        background: 'var(--surface-page)',
        borderTop: '2px solid #FFDA27',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          <span style={{ fontSize: 14 }}>📷</span>
          {nickname}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#22c55e', fontWeight: 500 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
          LIVE
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function WyzeCamWidget({ label, compact, pathSegments }: WidgetProps) {
  const [bridgeConfig] = usePluginStorage<BridgeConfig | null>('bridgeConfig', null);
  const cameraNameUri = pathSegments[0] || '';

  if (compact) {
    return <CamChip label={label || cameraNameUri} />;
  }

  if (!bridgeConfig) {
    return (
      <div style={{
        borderRadius: '10px',
        border: '1px solid var(--border-muted)',
        overflow: 'hidden',
        background: 'var(--surface-subtle)',
        padding: '24px 16px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>📷</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Open the Wyze Cameras drawer to configure the bridge
        </div>
      </div>
    );
  }

  return <StreamCard bridgeUrl={bridgeConfig.apiUrl} cameraNameUri={cameraNameUri} />;
}
