/**
 * Wyze Camera Entity Drawer
 *
 * entity-drawer canvas for wyze_cam entities.
 * Opens when the user clicks on a wyze_cam entity chip/card (e.g. from the feed).
 * Shows the live WebRTC camera stream in the drawer panel.
 */

import { useState, useEffect, useRef } from 'react';
import { usePluginStorage, logger } from '@drift/plugin-api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BridgeConfig {
  apiUrl: string;
}

interface DrawerProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
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
  ok: boolean; status: number; statusText: string; headers: Record<string, string>; body: string;
}> {
  // @ts-ignore
  return window.electron.invoke('drift:fetch', { url, method: 'GET' });
}

function decodeBody(body: string): string {
  try { return atob(body); } catch { return body; }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function WyzeCamEntityDrawer({ pathSegments, label }: DrawerProps) {
  const [bridgeConfig] = usePluginStorage<BridgeConfig | null>('bridgeConfig', null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionState, setConnectionState] = useState<string>('new');

  const cameraName = pathSegments[0] || '';
  const cameraNickname = label || cameraName;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !bridgeConfig || !cameraName) return;

    let cancelled = false;
    setError(null);
    setLoading(true);
    setConnectionState('new');

    const connect = async () => {
      try {
        const sigResp = await ipcFetch(`${bridgeConfig.apiUrl}/signaling/${cameraName}`);
        if (!sigResp.ok) throw new Error(`Signaling failed: ${sigResp.status}`);
        const signal: SignalingData = JSON.parse(decodeBody(sigResp.body));

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
            logger.error('WebRTC entity drawer: message error', { err: String(err) });
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
          } catch (err) {
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
  }, [bridgeConfig, cameraName]);

  if (!bridgeConfig) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>📷</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          Wyze Camera
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Open the Wyze Cameras sidebar to set up your server
        </div>
      </div>
    );
  }

  if (!cameraName) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>📷</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Camera not found</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>📷</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          {cameraNickname}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', background: '#000', flexShrink: 0, overflow: 'hidden' }}>
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
        <video ref={videoRef} controls muted autoPlay playsInline
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
      <div style={{
        padding: '14px 16px',
        borderTop: '2px solid #FFDA27',
        background: 'var(--surface-page)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
          }}>
            <span style={{ fontSize: 16 }}>📷</span>
            {cameraNickname}
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
