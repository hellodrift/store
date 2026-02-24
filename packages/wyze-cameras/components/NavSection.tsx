import { useState, useEffect, useCallback } from 'react';
import { NavSection, NavItem, StatusBadge } from '@drift/design/components';
import { usePluginStorage, logger } from '@drift/plugin-api';

interface Props {
  data?: Record<string, unknown>;
  onSelect?: (item: { id: string; type?: string; data?: unknown }) => void;
}

interface BridgeConfig {
  apiUrl: string;
}

interface CameraInfo {
  name_uri: string;
  nickname: string;
  connected: boolean;
  enabled: boolean;
  model_name?: string;
}

const STATUS_MAP: Record<string, 'idle' | 'pending' | 'success' | 'error'> = {
  connected: 'success',
  connecting: 'pending',
  disabled: 'idle',
  offline: 'error',
};

function getCameraStatus(cam: CameraInfo): string {
  if (!cam.enabled) return 'disabled';
  if (cam.connected) return 'connected';
  return 'offline';
}

// IPC fetch — bypasses CORS by routing through Electron main process
async function ipcFetch(url: string): Promise<{
  ok: boolean; status: number; body: string;
}> {
  // @ts-ignore window.electron exists in Drift's preload
  return window.electron.invoke('drift:fetch', { url, method: 'GET' });
}

export default function WyzeCamerasNavSection({ onSelect }: Props) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [bridgeConfig] = usePluginStorage<BridgeConfig | null>('bridgeConfig', null);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCameras = useCallback(async () => {
    if (!bridgeConfig) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await ipcFetch(`${bridgeConfig.apiUrl}/api`);
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const data = JSON.parse(atob(resp.body));

      const cams: CameraInfo[] = (Array.isArray(data) ? data : []).map((cam: any) => ({
        name_uri: cam.name_uri || cam.mac,
        nickname: cam.nickname || cam.name_uri || cam.mac,
        connected: cam.online ?? false,
        enabled: true,
        model_name: cam.model_name,
      }));

      logger.info('Fetched cameras', { count: cams.length });
      setCameras(cams);
    } catch (err) {
      logger.error('Failed to fetch cameras', { err: String(err) });
      setError(err instanceof Error ? err.message : 'Connection failed');
      setCameras([]);
    } finally {
      setLoading(false);
    }
  }, [bridgeConfig]);

  // Fetch cameras on mount and poll every 30s
  useEffect(() => {
    if (!bridgeConfig) return;
    fetchCameras();
    const interval = setInterval(fetchCameras, 30000);
    return () => clearInterval(interval);
  }, [bridgeConfig, fetchCameras]);

  const sectionData = {
    id: 'wyze-cameras',
    label: 'Wyze Cameras',
    items: [],
  };

  // Not configured — show setup item
  if (!bridgeConfig) {
    return (
      <NavSection
        section={sectionData}
        isExpanded={isExpanded}
        onToggle={(_, expanded) => setIsExpanded(expanded)}
      >
        <NavItem
          item={{
            id: 'configure',
            label: 'Configure Bridge',
            variant: 'item',
            icon: <span style={{ fontSize: 12 }}>&#x2699;</span>,
          }}
          onSelect={() => onSelect?.({ id: 'open-drawer', type: 'drawer', data: { view: 'settings' } })}
        />
      </NavSection>
    );
  }

  return (
    <NavSection
      section={sectionData}
      isExpanded={isExpanded}
      onToggle={(_, expanded) => setIsExpanded(expanded)}
    >
      {loading && cameras.length === 0 && (
        <div className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Loading cameras...
        </div>
      )}

      {error && cameras.length === 0 && (
        <NavItem
          item={{
            id: 'error',
            label: error,
            variant: 'item',
            icon: <span style={{ fontSize: 12 }}>&#x26A0;</span>,
            meta: <StatusBadge status="error" size="sm" />,
          }}
          onSelect={() => onSelect?.({ id: 'open-drawer', type: 'drawer', data: { view: 'settings' } })}
        />
      )}

      {cameras.map(cam => {
        const status = getCameraStatus(cam);
        return (
          <NavItem
            key={cam.name_uri}
            item={{
              id: cam.name_uri,
              label: cam.nickname,
              variant: 'item',
              icon: <span style={{ fontSize: 12 }}>📷</span>,
              meta: <StatusBadge status={STATUS_MAP[status] || 'idle'} size="sm" />,
            }}
            onSelect={() => onSelect?.({
              id: 'open-drawer',
              type: 'drawer',
              data: { view: 'camera', cameraName: cam.name_uri, cameraNickname: cam.nickname },
            })}
          />
        );
      })}

      {/* Settings gear at the bottom */}
      <NavItem
        item={{
          id: 'settings',
          label: 'Settings',
          variant: 'item',
          icon: <span style={{ fontSize: 12 }}>&#x2699;</span>,
        }}
        onSelect={() => onSelect?.({ id: 'open-drawer', type: 'drawer', data: { view: 'settings' } })}
      />
    </NavSection>
  );
}
