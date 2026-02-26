/**
 * AlertWidget — Inline entity widget for active_alert.
 *
 * Renders in two modes:
 *   compact: true  → inline chip (in chat messages, floating widget)
 *   compact: false → block card (standalone entity card in chat)
 *
 * Also used as the floating-widget canvas (always compact: true).
 */

import { useEntityQuery, gql, logger, EntityChip } from '@drift/plugin-api';

const GET_ALERT = gql`
  query GetAlertWidget($fingerprint: String!) {
    obsAlert(fingerprint: $fingerprint) {
      fingerprint
      alertname
      severity
      state
      duration
      summary
    }
  }
`;

interface ObsAlert {
  fingerprint: string;
  alertname: string;
  severity?: string;
  state: string;
  duration?: string;
  summary?: string;
}

interface AlertWidgetProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  compact: boolean;
  messageId?: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#e5484d',
  warning: '#e5933a',
  info: '#0ea5e9',
};

const SEVERITY_BG: Record<string, string> = {
  critical: 'rgba(229, 72, 77, 0.15)',
  warning: 'rgba(229, 147, 58, 0.15)',
  info: 'rgba(14, 165, 233, 0.15)',
};

function AlertChip({
  alert,
  loading,
  label,
}: {
  alert?: ObsAlert;
  loading: boolean;
  label?: string;
}) {
  if (loading) {
    return (
      <EntityChip
        label="Loading..."
        color="var(--surface-subtle)"
        textColor="var(--text-muted)"
      />
    );
  }

  if (!alert) {
    return (
      <EntityChip
        label={label || 'Alert (resolved)'}
        color="var(--surface-subtle)"
        textColor="var(--text-muted)"
      />
    );
  }

  const isSilenced = alert.state === 'silenced';
  const color = isSilenced ? 'var(--surface-elevated)' : (SEVERITY_COLORS[alert.severity ?? ''] ?? '#e5484d');
  const textColor = isSilenced ? 'var(--text-muted)' : '#fff';
  const prefix = isSilenced ? '🔇' : alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵';

  return (
    <EntityChip
      label={`${prefix} ${alert.alertname}${alert.duration ? ` · ${alert.duration}` : ''}`}
      color={isSilenced ? 'var(--surface-elevated)' : color}
      textColor={textColor}
      title={alert.summary ?? alert.alertname}
    />
  );
}

function AlertCard({
  alert,
  loading,
  error,
}: {
  alert?: ObsAlert;
  loading: boolean;
  error?: { message: string };
}) {
  if (loading) {
    return (
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 8,
          border: '1px solid var(--border-muted)',
          background: 'var(--surface-subtle)',
        }}
      >
        <div style={{ height: 14, width: 100, borderRadius: 4, background: 'var(--surface-hover)', marginBottom: 8 }} />
        <div style={{ height: 12, width: 220, borderRadius: 4, background: 'var(--surface-hover)' }} />
      </div>
    );
  }

  if (error || !alert) {
    return (
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 8,
          border: '1px solid var(--border-muted)',
          background: 'var(--surface-subtle)',
          color: 'var(--text-muted)',
          fontSize: 12,
        }}
      >
        {error ? `Failed to load alert: ${error.message}` : 'Alert resolved or not found'}
      </div>
    );
  }

  const isSilenced = alert.state === 'silenced';
  const severityColor = isSilenced ? 'var(--border-muted)' : (SEVERITY_COLORS[alert.severity ?? ''] ?? '#e5484d');
  const severityBg = isSilenced ? 'var(--surface-subtle)' : (SEVERITY_BG[alert.severity ?? ''] ?? 'rgba(229, 72, 77, 0.08)');

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        background: severityBg,
        borderTop: '1px solid var(--border-muted)',
        borderRight: '1px solid var(--border-muted)',
        borderBottom: '1px solid var(--border-muted)',
        borderLeft: `3px solid ${severityColor}`,
        opacity: isSilenced ? 0.7 : 1,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!isSilenced && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: severityColor,
                display: 'inline-block',
                boxShadow: `0 0 5px ${severityColor}`,
              }}
            />
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {alert.alertname}
          </span>
        </div>
        {alert.severity && (
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'var(--surface-hover)',
              color: isSilenced ? 'var(--text-muted)' : severityColor,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {isSilenced ? 'silenced' : alert.severity}
          </span>
        )}
      </div>

      {/* Summary */}
      {alert.summary && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginBottom: 8,
            lineHeight: 1.4,
          }}
        >
          {alert.summary}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: 'var(--text-muted)',
        }}
      >
        <span>🚨 Alert</span>
        {alert.duration && <span>firing {alert.duration}</span>}
      </div>
    </div>
  );
}

export default function AlertWidget({
  uri,
  pathSegments,
  label,
  compact,
}: AlertWidgetProps) {
  const fingerprint = pathSegments[0];

  const { data, loading, error } = useEntityQuery(GET_ALERT, {
    variables: { fingerprint },
    skip: !fingerprint,
  });

  const alert = data?.obsAlert as ObsAlert | undefined;

  if (error) {
    logger.error('Failed to load alert for widget', { fingerprint, uri, error: error.message });
  }

  if (compact) {
    return <AlertChip alert={alert} loading={loading} label={label} />;
  }

  return <AlertCard alert={alert} loading={loading} error={error} />;
}
