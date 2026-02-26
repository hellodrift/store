/**
 * AlertDrawer — Entity drawer for active_alert.
 *
 * Opens automatically when an active_alert entity is selected.
 * Provides:
 *   - Full alert detail (labels, annotations, severity, duration)
 *   - Silence controls with quick duration buttons
 *   - Workstream linking (incident → workstream) via useWorkstreamLinker
 *   - "View in Grafana" / "View generator" links
 */

import { useState, useCallback } from 'react';
import {
  DrawerHeaderTitle,
  DrawerHeaderActions,
  DrawerBody,
  ContentProvider,
  ContentSection,
  MetadataList,
  MetadataRow,
  ActionBar,
  Button,
  Badge,
  Separator,
  WorkstreamHeaderAction,
  WorkstreamSection,
  type LinkedWorkstream,
  type ActiveWorkstream,
} from '@drift/ui';
import {
  useEntityQuery,
  useEntityMutation,
  gql,
  logger,
  openExternal,
  useWorkstreamLinker,
  buildEntityURI,
} from '@drift/plugin-api';
import { useObsConfig } from './useObsConfig';

// ─── GraphQL ──────────────────────────────────────────────────────────────

const GET_ALERT = gql`
  query GetAlert($fingerprint: String!) {
    obsAlert(fingerprint: $fingerprint) {
      fingerprint
      alertname
      severity
      state
      summary
      description
      labels
      startsAt
      duration
      generatorURL
      silencedBy
    }
  }
`;

const SILENCE_ALERT = gql`
  mutation SilenceAlertFromDrawer(
    $alertname: String!
    $labels: String
    $durationMinutes: Int!
    $comment: String
  ) {
    obsSilenceAlert(
      alertname: $alertname
      labels: $labels
      durationMinutes: $durationMinutes
      comment: $comment
    ) {
      success
      message
    }
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────

interface ObsAlert {
  fingerprint: string;
  alertname: string;
  severity?: string;
  state: string;
  summary?: string;
  description?: string;
  labels?: string;
  startsAt: string;
  duration: string;
  generatorURL?: string;
  silencedBy: string[];
}

interface EntityDrawerProps {
  entityId: string;
  entityType: string;
  label?: string;
  drawer: {
    close: () => void;
    open: (uri: string) => void;
    push: (uri: string) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--status-error)',
  warning: 'var(--status-warning)',
  info: 'var(--brand-primary)',
};

const SEVERITY_BG: Record<string, string> = {
  critical: 'rgba(229, 72, 77, 0.12)',
  warning: 'rgba(229, 147, 58, 0.12)',
  info: 'rgba(14, 165, 233, 0.12)',
};

const SILENCE_DURATIONS = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '4h', minutes: 240 },
  { label: '1d', minutes: 1440 },
];

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─── Component ────────────────────────────────────────────────────────────

export default function AlertDrawer({ entityId, label, drawer }: EntityDrawerProps) {
  const [config] = useObsConfig();
  const [silenceFeedback, setSilenceFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [isSilencing, setIsSilencing] = useState(false);

  // ── Data ────────────────────────────────────────────────────────────────
  const { data, loading, error, refetch } = useEntityQuery(GET_ALERT, {
    variables: { fingerprint: entityId },
  });

  const alert: ObsAlert | undefined = data?.obsAlert;

  // ── Workstream linking ──────────────────────────────────────────────────
  const entityUri = buildEntityURI('active_alert', entityId, alert?.alertname ?? label ?? entityId);
  const workstreamLinker = useWorkstreamLinker(entityUri, 'active_alert');

  // ── Mutations ───────────────────────────────────────────────────────────
  const [silenceAlert] = useEntityMutation(SILENCE_ALERT);

  const handleSilence = useCallback(async (minutes: number) => {
    if (!alert) return;
    setIsSilencing(true);
    try {
      const result = await silenceAlert({
        variables: {
          alertname: alert.alertname,
          labels: alert.labels,
          durationMinutes: minutes,
        },
      });
      const res = result.data?.obsSilenceAlert;
      setSilenceFeedback({ msg: res?.message ?? 'Silenced', ok: res?.success ?? true });
      setTimeout(() => {
        setSilenceFeedback(null);
        refetch();
      }, 2000);
    } catch (err: any) {
      logger.error('Failed to silence alert from drawer', { error: err?.message });
      setSilenceFeedback({ msg: `Failed: ${err?.message}`, ok: false });
      setTimeout(() => setSilenceFeedback(null), 3000);
    } finally {
      setIsSilencing(false);
    }
  }, [alert, silenceAlert, refetch]);

  // ── Loading / error states ───────────────────────────────────────────────
  if (loading && !alert) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
          Loading alert...
        </div>
      </div>
    );
  }

  if ((error || !alert) && !loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
          {error ? `Error: ${error.message}` : 'Alert not found — it may have resolved.'}
        </div>
      </div>
    );
  }

  if (!alert) return null;

  const isSilenced = alert.state === 'silenced';
  const labels = alert.labels ? (() => { try { return JSON.parse(alert.labels!); } catch { return {}; } })() : {};

  const severityColor = SEVERITY_COLORS[alert.severity ?? ''] ?? 'var(--text-muted)';
  const severityBg = SEVERITY_BG[alert.severity ?? ''] ?? 'var(--surface-subtle)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <DrawerHeaderTitle>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: isSilenced ? 'var(--border-muted)' : severityColor,
              display: 'inline-block',
              flexShrink: 0,
              boxShadow: isSilenced ? 'none' : `0 0 6px ${severityColor}`,
            }}
          />
          {alert.alertname}
        </span>
      </DrawerHeaderTitle>

      <DrawerHeaderActions>
        {workstreamLinker.activeWorkstreams && (
          <WorkstreamHeaderAction
            entityId={entityId}
            entityTitle={alert.alertname}
            linkedWorkstreams={workstreamLinker.linkedWorkstreams}
            activeWorkstreams={workstreamLinker.activeWorkstreams}
            onStartWorkstream={async (_id, title) => {
              const workstreamId = await workstreamLinker.startWorkstream(title);
              if (workstreamId) {
                await sendWorkstreamMessage(
                  workstreamId,
                  `Investigate this alert and help with incident response.`,
                );
              }
            }}
          />
        )}
      </DrawerHeaderActions>

      <DrawerBody>
        <ContentProvider density="compact">
          {/* Severity + state banner */}
          <div
            style={{
              margin: '0 16px 12px',
              padding: '8px 12px',
              borderRadius: 6,
              background: severityBg,
              borderLeft: `3px solid ${isSilenced ? 'var(--border-muted)' : severityColor}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              {alert.severity && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: isSilenced ? 'var(--text-muted)' : severityColor,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginRight: 8,
                  }}
                >
                  {alert.severity}
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {isSilenced ? 'silenced' : alert.state}
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              firing {alert.duration}
            </span>
          </div>

          {/* Summary */}
          {alert.summary && (
            <ContentSection>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, padding: '0 16px' }}>
                {alert.summary}
              </div>
            </ContentSection>
          )}

          {/* Description */}
          {alert.description && alert.description !== alert.summary && (
            <ContentSection title="Description">
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.6,
                  padding: '0 16px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {alert.description}
              </div>
            </ContentSection>
          )}

          {/* Metadata */}
          <ContentSection title="Details">
            <MetadataList>
              <MetadataRow label="Started" value={formatTimestamp(alert.startsAt)} />
              <MetadataRow label="Duration" value={alert.duration} />
              <MetadataRow label="State" value={alert.state} />
              {alert.silencedBy.length > 0 && (
                <MetadataRow label="Silence ID" value={alert.silencedBy[0]} />
              )}
            </MetadataList>
          </ContentSection>

          {/* Labels */}
          {Object.keys(labels).length > 0 && (
            <ContentSection title="Labels">
              <MetadataList>
                {Object.entries(labels)
                  .filter(([k]) => k !== '__schema__')
                  .map(([key, value]) => (
                    <MetadataRow key={key} label={key} value={String(value)} />
                  ))}
              </MetadataList>
            </ContentSection>
          )}

          {/* Silence controls */}
          {!isSilenced && (
            <ContentSection title="Silence Alert">
              {silenceFeedback ? (
                <div
                  style={{
                    padding: '8px 16px',
                    fontSize: 12,
                    color: silenceFeedback.ok ? 'var(--text-secondary)' : 'var(--status-error)',
                  }}
                >
                  {silenceFeedback.msg}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6, padding: '0 16px', flexWrap: 'wrap' }}>
                  {SILENCE_DURATIONS.map(({ label: dLabel, minutes }) => (
                    <button
                      key={minutes}
                      disabled={isSilencing}
                      style={{
                        fontSize: 12,
                        padding: '4px 12px',
                        borderRadius: 5,
                        border: '1px solid var(--border-muted)',
                        background: isSilencing ? 'var(--surface-subtle)' : 'var(--surface-elevated)',
                        color: 'var(--text-secondary)',
                        cursor: isSilencing ? 'not-allowed' : 'pointer',
                        opacity: isSilencing ? 0.5 : 1,
                      }}
                      onClick={() => handleSilence(minutes)}
                    >
                      {dLabel}
                    </button>
                  ))}
                </div>
              )}
            </ContentSection>
          )}

          {/* External links */}
          <ContentSection title="Links">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 16px' }}>
              {alert.generatorURL && (
                <button
                  style={{
                    fontSize: 12,
                    padding: '6px 10px',
                    borderRadius: 5,
                    border: '1px solid var(--border-muted)',
                    background: 'var(--surface-subtle)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                  onClick={() => openExternal(alert.generatorURL!)}
                >
                  <span>View in Prometheus</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>↗</span>
                </button>
              )}
              <button
                style={{
                  fontSize: 12,
                  padding: '6px 10px',
                  borderRadius: 5,
                  border: '1px solid var(--border-muted)',
                  background: 'var(--surface-subtle)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
                onClick={() => openExternal(`${config.grafanaUrl}/d/drift-services`)}
              >
                <span>Open Services Dashboard</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>↗ Grafana</span>
              </button>
            </div>
          </ContentSection>

          {/* Workstream linking */}
          {workstreamLinker.activeWorkstreams && (
            <WorkstreamSection
              workstreams={workstreamLinker.linkedWorkstreams ?? []}
              entityId={entityId}
              entityTitle={alert.alertname}
              activeWorkstreams={workstreamLinker.activeWorkstreams}
              onRemove={workstreamLinker.unlinkWorkstream}
              onLink={workstreamLinker.linkWorkstream}
              onNavigate={(ws: LinkedWorkstream) => {
                workstreamLinker.navigateToWorkstream(ws);
                drawer.close();
              }}
            />
          )}
        </ContentProvider>
      </DrawerBody>
    </div>
  );
}
