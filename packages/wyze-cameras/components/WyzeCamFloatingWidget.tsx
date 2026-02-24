/**
 * Wyze Camera Floating Widget
 *
 * floating-widget canvas for wyze_cam entities.
 * Compact mini live stream that appears when the user manually
 * detaches the camera card (autoDetach: false in manifest).
 *
 * Starts a WebRTC connection to the Wyze bridge for PiP-style viewing.
 */

import { useState, useEffect, useRef } from 'react';
import { usePluginStorage, logger } from '@drift/plugin-api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BridgeConfig {
  apiUrl: string;
}

interface FloatingWidgetProps {
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
  ok: boolean; status: number; statusText: string; headers: Record<string, string>; body: string;
}> {
  // @ts-ignore
  return window.electron.invoke('drift:fetch', { url, method: 'GET' });
}

function decodeBody(body: string): string {
  try { return atob(body); } catch { return body; }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function WyzeCamFloatingWidget({ pathSegments, label }: FloatingWidgetProps) {
  const [bridgeConfig] = usePluginStorage<BridgeConfig | null>('bridgeConfig', null);
  const cameraName = pathSegments[0] || '';
  const cameraNickname = label || cameraName;

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !bridgeConfig || !cameraName) return;

    let cancelled = false;
    setError(null);
    setLoading(true);

    const connect = async () => {
      try {
        const sigResp = await ipcFetch(`${bridgeConfig.apiUrl}/signaling/${cameraName}`);
        if (!sigResp.ok) throw new Error(`Signaling failed: ${sigResp.status}`);
        const signal: SignalingData = JSON.parse(decodeBody(sigResp.body));

        if (signal.result !== 'ok') throw new Error(signal.result || 'Signaling failed');
        if (cancelled) return;

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
          if (state === 'connected' || state === 'completed') {
            setLoading(false);
          } else if (state === 'failed') {
            if (!cancelled) { setError('Connection failed'); setLoading(false); }
          } else if (state === 'disconnected') {
            setTimeout(() => {
              if (pc.iceConnectionState === 'disconnected' && !cancelled) {
                setError('Disconnected');
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
            logger.error('WebRTC float: message error', { err: String(err) });
          }
        };

        ws.onerror = () => {
          if (!cancelled) { setError('Signaling error'); setLoading(false); }
        };

        ws.onopen = async () => {
          if (cancelled) return;
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
                setError('Timed out');
                setLoading(false);
              }
            }, 30000);
          } catch {
            if (!cancelled) { setError('Setup failed'); setLoading(false); }
          }
        };

      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed');
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

  if (!bridgeConfig || !cameraName) {
    return (
      <div style={{ padding: '10px 12px', textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Not configured</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '10px 12px', textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{ overflow: 'hidden' }}>
      <div style={{ position: 'relative', width: '100%' }}>
        {loading && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#000', zIndex: 1,
            minHeight: 120,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>Connecting...</div>
          </div>
        )}
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ width: '100%', display: 'block' }}
        />
      </div>

      <div style={{
        padding: '6px 10px',
        borderTop: '2px solid #FFDA27',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 11, fontWeight: 600, color: 'var(--text-primary)',
        }}>
          <span style={{ fontSize: 12 }}>📷</span>
          {cameraNickname}
        </span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 3,
          fontSize: 9, color: '#22c55e', fontWeight: 500,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: '#22c55e', display: 'inline-block',
          }} />
          LIVE
        </span>
      </div>
    </div>
  );
}
