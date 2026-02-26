/**
 * Observability Main Drawer
 *
 * Four tabs accessible from the nav sidebar:
 *   1. Alerts  — live list from Alertmanager with silence + entity link
 *   2. Metrics — service health grid + Prometheus stats from PromQL
 *   3. Logs    — live log tail from Loki with service/level filters
 *   4. Settings — URL configuration
 *
 * Tab is set via payload.tab (from NavSection onSelect).
 */

import { useState, useCallback, useMemo } from 'react';
import {
  DrawerHeaderTitle,
  DrawerBody,
  ContentProvider,
  ContentSection,
  MetadataList,
  MetadataRow,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@drift/ui';
import {
  useEntityQuery,
  useEntityMutation,
  usePluginStorage,
  gql,
  logger,
  openExternal,
  useEntityDrawer,
  buildEntityURI,
} from '@drift/plugin-api';

// ─── GraphQL ──────────────────────────────────────────────────────────────

const OBS_ALERTS = gql`
  query DrawerAlerts {
    obsAlerts {
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

const OBS_TARGETS = gql`
  query DrawerTargets {
    obsTargets {
      job
      instance
      health
      lastScrape
      lastError
    }
  }
`;

const OBS_SUMMARY = gql`
  query DrawerSummary {
    obsSummary {
      alertCount
      criticalCount
      warningCount
      healthyTargets
      totalTargets
      allHealthy
      storageBytes
      ingestionRate
      activeSeries
    }
  }
`;

const OBS_LOGS = gql`
  query DrawerLogs($logql: String, $limit: Int, $since: String) {
    obsLogs(logql: $logql, limit: $limit, since: $since) {
      timestamp
      service
      level
      message
      labels
    }
  }
`;

const OBS_LOKI_SERVICES = gql`
  query LokiServices {
    obsLokiLabelValues(label: "service")
  }
`;

const OBS_CONFIG = gql`
  query ObsConfig {
    obsConfig {
      prometheusUrl
      lokiUrl
      alertmanagerUrl
      grafanaUrl
      grafanaAuthType
      prometheusAuth
      lokiAuth
      alertmanagerAuth
    }
  }
`;

const SAVE_OBS_SETTINGS = gql`
  mutation SaveObsSettings($input: ObsSettingsInput!) {
    saveObsSettings(input: $input) {
      success
      message
    }
  }
`;

const SILENCE_ALERT = gql`
  mutation SilenceAlert($alertname: String!, $labels: String, $durationMinutes: Int!, $comment: String) {
    obsSilenceAlert(alertname: $alertname, labels: $labels, durationMinutes: $durationMinutes, comment: $comment) {
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

interface ObsTarget {
  job: string;
  instance: string;
  health: string;
  lastScrape?: string;
  lastError?: string;
}

interface ObsLogLine {
  timestamp: string;
  service: string;
  level: string;
  message: string;
  labels?: string;
}

interface DrawerProps {
  payload?: Record<string, unknown>;
  drawer?: {
    close: () => void;
    open: (payload: Record<string, unknown>) => void;
    push: (uri: string) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId?: string;
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

const LEVEL_COLORS: Record<string, string> = {
  error: 'var(--status-error)',
  fatal: 'var(--status-error)',
  warn: 'var(--status-warning)',
  warning: 'var(--status-warning)',
  info: 'var(--text-secondary)',
  debug: 'var(--text-muted)',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function formatRate(samplesPerSec: number): string {
  const perMin = samplesPerSec * 60;
  if (perMin < 1000) return `${perMin.toFixed(0)}/min`;
  return `${(perMin / 1000).toFixed(1)}k/min`;
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Sub-components ───────────────────────────────────────────────────────

function AlertRow({
  alert,
  onSilence,
  onOpenEntity,
  onOpenGenerator,
}: {
  alert: ObsAlert;
  onSilence: (alert: ObsAlert, minutes: number) => void;
  onOpenEntity: (fingerprint: string, name: string) => void;
  onOpenGenerator: (url: string) => void;
}) {
  const [showSilence, setShowSilence] = useState(false);
  const isSilenced = alert.state === 'silenced';

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 6,
        background: isSilenced ? 'var(--surface-subtle)' : (SEVERITY_BG[alert.severity ?? ''] ?? 'var(--surface-subtle)'),
        borderLeft: `3px solid ${isSilenced ? 'var(--border-muted)' : (SEVERITY_COLORS[alert.severity ?? ''] ?? 'var(--text-muted)')}`,
        marginBottom: 6,
        opacity: isSilenced ? 0.6 : 1,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}
            onClick={() => onOpenEntity(alert.fingerprint, alert.alertname)}
          >
            {alert.alertname}
          </span>
          {alert.severity && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: SEVERITY_COLORS[alert.severity] ?? 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {alert.severity}
            </span>
          )}
          {isSilenced && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>silenced</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
          {alert.duration}
        </span>
      </div>

      {/* Summary */}
      {alert.summary && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.4 }}>
          {alert.summary}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid var(--border-muted)',
            background: 'var(--surface-page)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
          onClick={() => onOpenEntity(alert.fingerprint, alert.alertname)}
        >
          Details
        </button>

        {!isSilenced && (
          <button
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid var(--border-muted)',
              background: 'var(--surface-page)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            onClick={() => setShowSilence(!showSilence)}
          >
            Silence
          </button>
        )}

        {alert.generatorURL && (
          <button
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid var(--border-muted)',
              background: 'var(--surface-page)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            onClick={() => onOpenGenerator(alert.generatorURL!)}
          >
            Graph ↗
          </button>
        )}
      </div>

      {/* Inline silence picker */}
      {showSilence && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
            Silence for:
          </span>
          {[
            { label: '15m', minutes: 15 },
            { label: '1h', minutes: 60 },
            { label: '4h', minutes: 240 },
            { label: '1d', minutes: 1440 },
          ].map(({ label, minutes }) => (
            <button
              key={minutes}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--border-muted)',
                background: 'var(--brand-primary)',
                color: '#fff',
                cursor: 'pointer',
              }}
              onClick={() => {
                onSilence(alert, minutes);
                setShowSilence(false);
              }}
            >
              {label}
            </button>
          ))}
          <button
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid var(--border-muted)',
              background: 'var(--surface-page)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
            onClick={() => setShowSilence(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────

function AlertsTab({
  onOpenEntity,
}: {
  onOpenEntity: (fingerprint: string, name: string) => void;
}) {
  const { data, loading, refetch } = useEntityQuery(OBS_ALERTS, {
    pollInterval: 30_000,
    fetchPolicy: 'cache-and-network',
  });
  const [silenceAlert] = useEntityMutation(SILENCE_ALERT);
  const [silenceMessage, setSilenceMessage] = useState<string | null>(null);

  const alerts: ObsAlert[] = data?.obsAlerts ?? [];
  const activeAlerts = alerts.filter((a) => a.state === 'active');
  const silencedAlerts = alerts.filter((a) => a.state === 'silenced');

  const handleSilence = useCallback(async (alert: ObsAlert, minutes: number) => {
    try {
      const labels = alert.labels ?? undefined;
      const result = await silenceAlert({
        variables: {
          alertname: alert.alertname,
          labels: labels,
          durationMinutes: minutes,
        },
      });
      const msg = result.data?.obsSilenceAlert?.message ?? 'Silenced';
      setSilenceMessage(msg);
      setTimeout(() => setSilenceMessage(null), 3000);
      refetch();
    } catch (err: any) {
      logger.error('Failed to silence alert', { error: err?.message });
      setSilenceMessage('Failed to create silence');
      setTimeout(() => setSilenceMessage(null), 3000);
    }
  }, [silenceAlert, refetch]);

  if (loading && !data) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
        Loading alerts...
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px' }}>
      {silenceMessage && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'var(--surface-subtle)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {silenceMessage}
        </div>
      )}

      {activeAlerts.length === 0 && silencedAlerts.length === 0 && (
        <div
          style={{
            padding: '24px 16px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>✅</div>
          <div>No active alerts</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>All systems normal</div>
        </div>
      )}

      {activeAlerts.length > 0 && (
        <ContentSection title={`Active (${activeAlerts.length})`}>
          {activeAlerts.map((alert) => (
            <AlertRow
              key={alert.fingerprint}
              alert={alert}
              onSilence={handleSilence}
              onOpenEntity={onOpenEntity}
              onOpenGenerator={(url) => openExternal(url)}
            />
          ))}
        </ContentSection>
      )}

      {silencedAlerts.length > 0 && (
        <ContentSection title={`Silenced (${silencedAlerts.length})`}>
          {silencedAlerts.map((alert) => (
            <AlertRow
              key={alert.fingerprint}
              alert={alert}
              onSilence={handleSilence}
              onOpenEntity={onOpenEntity}
              onOpenGenerator={(url) => openExternal(url)}
            />
          ))}
        </ContentSection>
      )}
    </div>
  );
}

function MetricsTab({ grafanaUrl }: { grafanaUrl: string }) {
  const { data: summaryData, loading: summaryLoading } = useEntityQuery(OBS_SUMMARY, {
    pollInterval: 60_000,
    fetchPolicy: 'cache-and-network',
  });
  const { data: targetsData, loading: targetsLoading } = useEntityQuery(OBS_TARGETS, {
    pollInterval: 60_000,
    fetchPolicy: 'cache-and-network',
  });

  const summary = summaryData?.obsSummary;
  const targets: ObsTarget[] = targetsData?.obsTargets ?? [];

  const loading = (summaryLoading && !summaryData) || (targetsLoading && !targetsData);

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>Loading metrics...</div>;
  }

  // Group targets by job
  const byJob = new Map<string, ObsTarget[]>();
  for (const t of targets) {
    const arr = byJob.get(t.job) ?? [];
    arr.push(t);
    byJob.set(t.job, arr);
  }

  const healthyColor = 'var(--status-success, #30a46c)';
  const downColor = 'var(--status-error, #e5484d)';

  return (
    <div style={{ padding: '12px 16px' }}>
      {/* Summary stats */}
      {summary && (
        <ContentSection title="Stack Overview">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: '4px 0' }}>
            {[
              { label: 'Active Alerts', value: String(summary.alertCount), alert: summary.criticalCount > 0 },
              { label: 'Targets Up', value: `${summary.healthyTargets}/${summary.totalTargets}`, alert: !summary.allHealthy },
              summary.activeSeries != null
                ? { label: 'Active Series', value: summary.activeSeries > 1000 ? `${(summary.activeSeries / 1000).toFixed(1)}k` : String(Math.round(summary.activeSeries)), alert: false }
                : null,
              summary.storageBytes != null
                ? { label: 'TSDB Storage', value: formatBytes(summary.storageBytes), alert: false }
                : null,
              summary.ingestionRate != null
                ? { label: 'Ingestion', value: formatRate(summary.ingestionRate), alert: false }
                : null,
            ].filter(Boolean).map((stat) => (
              <div
                key={stat!.label}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--surface-subtle)',
                  border: `1px solid ${stat!.alert ? 'var(--status-error)' : 'var(--border-muted)'}`,
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 700, color: stat!.alert ? 'var(--status-error)' : 'var(--text-primary)', lineHeight: 1.2 }}>
                  {stat!.value}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {stat!.label}
                </div>
              </div>
            ))}
          </div>
        </ContentSection>
      )}

      {/* Scrape targets by job */}
      <ContentSection title="Scrape Targets">
        {targets.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>
            No targets — Prometheus may be unreachable
          </div>
        ) : (
          Array.from(byJob.entries()).map(([job, jobTargets]) => {
            const allUp = jobTargets.every((t) => t.health === 'up');
            const upCount = jobTargets.filter((t) => t.health === 'up').length;

            return (
              <div
                key={job}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border-muted)',
                }}
              >
                <div>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {job}
                  </span>
                  {jobTargets.length > 1 && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                      {jobTargets[0].instance}
                    </span>
                  )}
                  {jobTargets.length === 1 && !allUp && jobTargets[0].lastError && (
                    <div style={{ fontSize: 10, color: downColor, marginTop: 2 }}>
                      {jobTargets[0].lastError}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {jobTargets.length > 1 && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {upCount}/{jobTargets.length}
                    </span>
                  )}
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: allUp ? healthyColor : downColor,
                      boxShadow: allUp
                        ? `0 0 4px ${healthyColor}`
                        : `0 0 4px ${downColor}`,
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </ContentSection>

      {/* Grafana links */}
      <ContentSection title="Dashboards">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { label: 'Log Explorer', uid: 'drift-loki-logs' },
            { label: 'Services Overview', uid: 'drift-services' },
            { label: 'Infrastructure', uid: 'node-exporter-full' },
            { label: 'Containers', uid: 'cadvisor-containers' },
          ].map(({ label, uid }) => (
            <button
              key={uid}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                borderRadius: 5,
                border: '1px solid var(--border-muted)',
                background: 'var(--surface-subtle)',
                color: 'var(--text-secondary)',
                fontSize: 12,
                cursor: 'pointer',
                width: '100%',
              }}
              onClick={() => openExternal(`${grafanaUrl}/d/${uid}`)}
            >
              <span>{label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>↗ Grafana</span>
            </button>
          ))}
        </div>
      </ContentSection>
    </div>
  );
}

function LogsTab({ initialService }: { initialService?: string }) {
  const [defaultLogMinutes] = usePluginStorage('obs:defaultLogMinutes', 1440);
  const [service, setService] = useState(initialService ?? 'all');
  const [level, setLevel] = useState('all');
  const [since] = useState(() => new Date(Date.now() - (defaultLogMinutes ?? 1440) * 60_000).toISOString());

  const logql = useMemo(() => {
    const filters: string[] = [service === 'all' ? 'service=~".+"' : `service="${service}"`];
    if (level !== 'all') filters.push(`level="${level}"`);
    return `{${filters.join(', ')}}`;
  }, [service, level]);

  const { data, loading, refetch } = useEntityQuery(OBS_LOGS, {
    variables: { logql, limit: 100, since },
    pollInterval: 15_000,
    fetchPolicy: 'cache-and-network',
  });

  const { data: servicesData } = useEntityQuery(OBS_LOKI_SERVICES);

  const logs: ObsLogLine[] = data?.obsLogs ?? [];
  const services: string[] = servicesData?.obsLokiLabelValues ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border-muted)', flexShrink: 0 }}>
        <Select value={service} onValueChange={setService}>
          <SelectTrigger style={{ fontSize: 12, height: 28, minWidth: 120 }}>
            <SelectValue placeholder="Service" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {services.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger style={{ fontSize: 12, height: 28, minWidth: 100 }}>
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="warn">Warn</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="debug">Debug</SelectItem>
          </SelectContent>
        </Select>

        <button
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid var(--border-muted)',
            background: 'var(--surface-page)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            marginLeft: 'auto',
          }}
          onClick={() => refetch()}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Log entries */}
      <div style={{ flex: 1, overflow: 'auto', fontFamily: 'monospace' }}>
        {loading && logs.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>
            Loading logs...
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            <div style={{ marginBottom: 8 }}>No log entries found</div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
              {logql}
            </div>
          </div>
        )}

        {logs.map((line, i) => {
          const ts = new Date(line.timestamp);
          const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const levelColor = LEVEL_COLORS[line.level] ?? 'var(--text-muted)';

          return (
            <div
              key={`${line.timestamp}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '3px 16px',
                fontSize: 11,
                lineHeight: 1.5,
                borderBottom: '1px solid var(--border-muted)',
                background: line.level === 'error' || line.level === 'fatal'
                  ? 'rgba(229, 72, 77, 0.04)'
                  : 'transparent',
              }}
            >
              <span style={{ color: 'var(--text-muted)', flexShrink: 0, minWidth: 60 }}>
                {timeStr}
              </span>
              <span
                style={{
                  color: levelColor,
                  fontWeight: 600,
                  flexShrink: 0,
                  minWidth: 36,
                  textTransform: 'uppercase',
                  fontSize: 10,
                }}
              >
                {line.level.slice(0, 4)}
              </span>
              <span style={{ color: 'var(--brand-primary)', flexShrink: 0, minWidth: 80 }}>
                {line.service}
              </span>
              <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word', flex: 1 }}>
                {line.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SettingsForm {
  prometheusUrl: string;
  lokiUrl: string;
  alertmanagerUrl: string;
  grafanaUrl: string;
  grafanaUser: string;
  grafanaPassword: string;
  grafanaApiKey: string;
  prometheusUser: string;
  prometheusPassword: string;
  lokiUser: string;
  lokiPassword: string;
  alertmanagerUser: string;
  alertmanagerPassword: string;
}

function CredentialField({
  label,
  value,
  onChange,
  isSet,
  onClear,
  isPassword,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isSet?: boolean;
  onClear?: () => void;
  isPassword?: boolean;
  placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</label>
        {isSet && !value && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--status-success, #30a46c)' }}>● Set</span>
            {onClear && (
              <button
                onClick={onClear}
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 3,
                  border: '1px solid var(--border-muted)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}
        {!isSet && !value && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Not set</span>
        )}
      </div>
      <Input
        type={isPassword ? 'password' : 'text'}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={isSet ? '••••••••  (leave blank to keep)' : (placeholder ?? '')}
        style={{ fontSize: 12 }}
      />
    </div>
  );
}

const LOG_RANGE_OPTIONS = [
  { label: '15m', minutes: 15 },
  { label: '1h',  minutes: 60 },
  { label: '6h',  minutes: 360 },
  { label: '24h', minutes: 1440 },
] as const;

function SettingsTab() {
  const [defaultLogMinutes, setDefaultLogMinutes] = usePluginStorage('obs:defaultLogMinutes', 1440);
  const { data: serverConfig, refetch: refetchConfig } = useEntityQuery(OBS_CONFIG, {
    fetchPolicy: 'cache-and-network',
  });
  const [saveSettings] = useEntityMutation(SAVE_OBS_SETTINGS);

  const cfg = serverConfig?.obsConfig;

  const [form, setForm] = useState<SettingsForm>({
    prometheusUrl: '',
    lokiUrl: '',
    alertmanagerUrl: '',
    grafanaUrl: '',
    grafanaUser: '',
    grafanaPassword: '',
    grafanaApiKey: '',
    prometheusUser: '',
    prometheusPassword: '',
    lokiUser: '',
    lokiPassword: '',
    alertmanagerUser: '',
    alertmanagerPassword: '',
  });

  // Pre-fill URL fields once server config loads
  const [urlsLoaded, setUrlsLoaded] = useState(false);
  if (cfg && !urlsLoaded) {
    setUrlsLoaded(true);
    setForm((prev) => ({
      ...prev,
      prometheusUrl: cfg.prometheusUrl,
      lokiUrl: cfg.lokiUrl,
      alertmanagerUrl: cfg.alertmanagerUrl,
      grafanaUrl: cfg.grafanaUrl,
    }));
  }

  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof SettingsForm) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Mark a credential for clearing (send empty string to resolver)
  const [clearFlags, setClearFlags] = useState<Partial<Record<keyof SettingsForm, boolean>>>({});
  const markClear = (key: keyof SettingsForm) => {
    setClearFlags((prev) => ({ ...prev, [key]: true }));
    setForm((prev) => ({ ...prev, [key]: '' }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);

    // Build input: only include fields that changed or are being cleared
    const input: Record<string, string | null> = {};

    // URLs — always send (pre-filled from server)
    input.prometheusUrl = form.prometheusUrl || null;
    input.lokiUrl = form.lokiUrl || null;
    input.alertmanagerUrl = form.alertmanagerUrl || null;
    input.grafanaUrl = form.grafanaUrl || null;

    // Credentials — only include if the user typed something, or if flagged for clearing
    const credFields: Array<keyof SettingsForm> = [
      'grafanaUser', 'grafanaPassword', 'grafanaApiKey',
      'prometheusUser', 'prometheusPassword',
      'lokiUser', 'lokiPassword',
      'alertmanagerUser', 'alertmanagerPassword',
    ];
    for (const key of credFields) {
      if (clearFlags[key]) {
        input[key] = null; // clear
      } else if (form[key]) {
        input[key] = form[key]; // set new value
      }
      // If empty and not flagged = leave unchanged (don't include in input)
    }

    try {
      const result = await saveSettings({ variables: { input } });
      const { success, message } = result.data?.saveObsSettings ?? {};
      setSaveStatus({ ok: success ?? false, msg: message ?? 'Done' });
      if (success) {
        // Clear the form credential fields and clear flags, then refetch status
        setForm((prev) => ({
          ...prev,
          grafanaUser: '', grafanaPassword: '', grafanaApiKey: '',
          prometheusUser: '', prometheusPassword: '',
          lokiUser: '', lokiPassword: '',
          alertmanagerUser: '', alertmanagerPassword: '',
        }));
        setClearFlags({});
        refetchConfig();
      }
    } catch (err: any) {
      setSaveStatus({ ok: false, msg: err?.message ?? 'Failed to save' });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  return (
    <div style={{ padding: '12px 16px' }}>
      {/* Status banner */}
      {saveStatus && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 12,
            background: saveStatus.ok ? 'rgba(48, 164, 108, 0.1)' : 'rgba(229, 72, 77, 0.1)',
            color: saveStatus.ok ? 'var(--status-success, #30a46c)' : 'var(--status-error)',
            border: `1px solid ${saveStatus.ok ? 'rgba(48, 164, 108, 0.3)' : 'rgba(229, 72, 77, 0.3)'}`,
          }}
        >
          {saveStatus.msg}
        </div>
      )}

      {/* Display Defaults */}
      <ContentSection title="Display Defaults">
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            Default log time range
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {LOG_RANGE_OPTIONS.map(({ label, minutes }) => (
              <button
                key={minutes}
                onClick={() => setDefaultLogMinutes(minutes)}
                style={{
                  padding: '3px 10px',
                  fontSize: 12,
                  borderRadius: 5,
                  border: '1px solid var(--border-muted)',
                  background: (defaultLogMinutes ?? 1440) === minutes ? 'var(--brand-primary)' : 'var(--surface-subtle)',
                  color: (defaultLogMinutes ?? 1440) === minutes ? '#fff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
            Applied when opening the Logs view or a service logs drawer.
          </div>
        </div>
      </ContentSection>

      {/* Service URLs */}
      <ContentSection title="Service URLs">
        {[
          { key: 'prometheusUrl' as const, label: 'Prometheus', placeholder: 'http://localhost:9090' },
          { key: 'lokiUrl' as const, label: 'Loki', placeholder: 'http://localhost:3100' },
          { key: 'alertmanagerUrl' as const, label: 'Alertmanager', placeholder: 'http://localhost:9093' },
          { key: 'grafanaUrl' as const, label: 'Grafana', placeholder: 'http://localhost:3200' },
        ].map(({ key, label, placeholder }) => (
          <div key={key} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>
              {label}
            </label>
            <Input
              value={form[key]}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(key)(e.target.value)}
              placeholder={placeholder}
              style={{ fontSize: 12 }}
            />
          </div>
        ))}
      </ContentSection>

      {/* Grafana credentials */}
      <ContentSection title="Grafana Credentials">
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          API key takes priority over username/password when both are set.
          {cfg?.grafanaAuthType === 'api_key' && (
            <span style={{ color: 'var(--status-success, #30a46c)', marginLeft: 6 }}>
              ● Using API key
            </span>
          )}
          {cfg?.grafanaAuthType === 'basic' && (
            <span style={{ color: 'var(--status-success, #30a46c)', marginLeft: 6 }}>
              ● Using basic auth
            </span>
          )}
        </div>
        <CredentialField
          label="Username"
          value={form.grafanaUser}
          onChange={set('grafanaUser')}
          isSet={cfg?.grafanaAuthType === 'basic'}
        />
        <CredentialField
          label="Password"
          value={form.grafanaPassword}
          onChange={set('grafanaPassword')}
          isSet={cfg?.grafanaAuthType === 'basic'}
          onClear={() => markClear('grafanaPassword')}
          isPassword
        />
        <CredentialField
          label="API Key / Service Account Token"
          value={form.grafanaApiKey}
          onChange={set('grafanaApiKey')}
          isSet={cfg?.grafanaAuthType === 'api_key'}
          onClear={() => markClear('grafanaApiKey')}
          isPassword
          placeholder="glsa_..."
        />
      </ContentSection>

      {/* Prometheus credentials */}
      <ContentSection title="Prometheus Credentials">
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          Basic auth for Prometheus API access.
          {cfg?.prometheusAuth && (
            <span style={{ color: 'var(--status-success, #30a46c)', marginLeft: 6 }}>● Set</span>
          )}
        </div>
        <CredentialField label="Username" value={form.prometheusUser} onChange={set('prometheusUser')} isSet={cfg?.prometheusAuth} />
        <CredentialField label="Password" value={form.prometheusPassword} onChange={set('prometheusPassword')} isSet={cfg?.prometheusAuth} onClear={() => markClear('prometheusPassword')} isPassword />
      </ContentSection>

      {/* Loki credentials */}
      <ContentSection title="Loki Credentials">
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          Basic auth for Loki log queries.
          {cfg?.lokiAuth && (
            <span style={{ color: 'var(--status-success, #30a46c)', marginLeft: 6 }}>● Set</span>
          )}
        </div>
        <CredentialField label="Username" value={form.lokiUser} onChange={set('lokiUser')} isSet={cfg?.lokiAuth} />
        <CredentialField label="Password" value={form.lokiPassword} onChange={set('lokiPassword')} isSet={cfg?.lokiAuth} onClear={() => markClear('lokiPassword')} isPassword />
      </ContentSection>

      {/* Alertmanager credentials */}
      <ContentSection title="Alertmanager Credentials">
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          Basic auth for Alertmanager.
          {cfg?.alertmanagerAuth && (
            <span style={{ color: 'var(--status-success, #30a46c)', marginLeft: 6 }}>● Set</span>
          )}
        </div>
        <CredentialField label="Username" value={form.alertmanagerUser} onChange={set('alertmanagerUser')} isSet={cfg?.alertmanagerAuth} />
        <CredentialField label="Password" value={form.alertmanagerPassword} onChange={set('alertmanagerPassword')} isSet={cfg?.alertmanagerAuth} onClear={() => markClear('alertmanagerPassword')} isPassword />
      </ContentSection>

      {/* Save button */}
      <div style={{ paddingTop: 4, paddingBottom: 16 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: '100%',
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: saving ? 'var(--surface-subtle)' : 'var(--brand-primary)',
            color: saving ? 'var(--text-muted)' : '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Drawer ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'alerts', label: 'Alerts' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'logs', label: 'Logs' },
] as const;

// 'settings' is not in the tab bar — only reachable via the gear icon in the nav sidebar
type TabId = typeof TABS[number]['id'] | 'settings';

export default function ObsDrawer({ payload, drawer }: DrawerProps) {
  const initialTab = (payload?.tab as TabId) ?? 'alerts';
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const { data: configData } = useEntityQuery(OBS_CONFIG);
  const grafanaUrl = configData?.obsConfig?.grafanaUrl ?? 'http://localhost:3200';
  const { openEntityDrawer } = useEntityDrawer();

  const handleOpenAlertEntity = useCallback((fingerprint: string, name: string) => {
    const uri = buildEntityURI('active_alert', fingerprint, name);
    openEntityDrawer(uri);
  }, [openEntityDrawer]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <DrawerHeaderTitle>Observability</DrawerHeaderTitle>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--border-muted)',
          padding: '0 16px',
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              fontSize: 12,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
              padding: '8px 12px',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--brand-primary)' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <DrawerBody style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ContentProvider density="compact">
          {activeTab === 'alerts' && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <AlertsTab onOpenEntity={handleOpenAlertEntity} />
            </div>
          )}
          {activeTab === 'metrics' && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <MetricsTab grafanaUrl={grafanaUrl} />
            </div>
          )}
          {activeTab === 'logs' && <LogsTab initialService={payload?.service as string | undefined} />}
          {activeTab === 'settings' && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <SettingsTab />
            </div>
          )}
        </ContentProvider>
      </DrawerBody>
    </div>
  );
}
