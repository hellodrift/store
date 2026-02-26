/**
 * Observability NavSection — sidebar status widget.
 *
 * Polls every 30s (via pollInterval) for:
 *   - Active alert count + severity breakdown
 *   - Stack health (all scrape targets up?)
 *
 * Clicking the section header opens the main Observability drawer.
 * The gear icon opens the settings view in the drawer.
 */

import { useState } from 'react';
import { NavSection, NavItem, NavSettingsButton, NavHeaderActions, StatusBadge } from '@drift/ui';
import { useEntityQuery, gql, logger, useEntityDrawer, buildEntityURI } from '@drift/plugin-api';

const OBS_SUMMARY = gql`
  query ObsSummary {
    obsSummary {
      alertCount
      criticalCount
      warningCount
      healthyTargets
      totalTargets
      allHealthy
    }
  }
`;

const OBS_ALERTS = gql`
  query ObsNavAlerts {
    obsAlerts {
      fingerprint
      alertname
      severity
      state
      duration
    }
  }
`;

interface ObsSummary {
  alertCount: number;
  criticalCount: number;
  warningCount: number;
  healthyTargets: number;
  totalTargets: number;
  allHealthy: boolean;
}

interface ObsAlert {
  fingerprint: string;
  alertname: string;
  severity?: string;
  state: string;
  duration?: string;
}

interface Props {
  data?: Record<string, unknown>;
  onSelect?: (item: { id: string; type?: string; data?: unknown }) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--status-error)',
  warning: 'var(--status-warning)',
  info: 'var(--brand-primary)',
};

export default function ObsNavSection({ onSelect }: Props) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { openEntityDrawer } = useEntityDrawer();

  const { data: summaryData, loading: summaryLoading } = useEntityQuery(OBS_SUMMARY, {
    pollInterval: 30_000,
    fetchPolicy: 'cache-and-network',
  });

  const { data: alertsData } = useEntityQuery(OBS_ALERTS, {
    pollInterval: 30_000,
    fetchPolicy: 'cache-and-network',
    skip: !isExpanded,
  });

  const summary: ObsSummary | undefined = summaryData?.obsSummary;
  const alerts: ObsAlert[] = alertsData?.obsAlerts ?? [];

  // Health dot: red if critical alerts, orange if warnings, gray if targets down, green if all healthy
  const healthStatus: 'error' | 'warning' | 'success' | 'idle' =
    (summary?.criticalCount ?? 0) > 0 ? 'error'
    : (summary?.warningCount ?? 0) > 0 ? 'warning'
    : summary?.allHealthy === true ? 'success'
    : 'idle';

  // Section label with counts
  let sectionLabel = 'Observability';
  if (summary) {
    const parts: string[] = [];
    if (summary.criticalCount > 0) parts.push(`${summary.criticalCount} critical`);
    else if (summary.alertCount > 0) parts.push(`${summary.alertCount} alert${summary.alertCount !== 1 ? 's' : ''}`);
    if (!summary.allHealthy && summary.totalTargets > 0) {
      const downCount = summary.totalTargets - summary.healthyTargets;
      if (downCount > 0) parts.push(`${downCount} down`);
    }
  }

  const section = {
    id: 'observability',
    label: sectionLabel,
    items: [],
    isLoading: summaryLoading && !summary,
    hoverActions: (
      <NavHeaderActions>
        <NavSettingsButton
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onSelect?.({ id: 'settings', type: 'drawer', data: { tab: 'settings' } });
          }}
          ariaLabel="Observability settings"
        />
      </NavHeaderActions>
    ),
  };

  const handleOpenDrawer = (tab: string = 'alerts') => {
    onSelect?.({ id: tab, type: 'drawer', data: { tab } });
  };

  const handleAlertClick = (alert: ObsAlert) => {
    logger.info('Opening alert entity', { fingerprint: alert.fingerprint, alertname: alert.alertname });
    openEntityDrawer(buildEntityURI('active_alert', alert.fingerprint, alert.alertname));
  };

  // Show active alerts in the nav (max 5)
  const visibleAlerts = alerts.filter((a) => a.state === 'active').slice(0, 5);

  return (
    <NavSection
      section={section}
      isExpanded={isExpanded}
      onToggle={(_, expanded) => setIsExpanded(expanded)}
    >
      {/* Status overview row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 12px 6px',
          cursor: 'pointer',
        }}
        onClick={() => handleOpenDrawer('alerts')}
      >
        <StatusBadge status={healthStatus} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {!summary
            ? 'Loading...'
            : summary.allHealthy && summary.alertCount === 0
            ? 'All systems healthy'
            : summary.alertCount === 0
            ? `${summary.healthyTargets}/${summary.totalTargets} targets up`
            : `${summary.alertCount} alert${summary.alertCount !== 1 ? 's' : ''} · ${summary.healthyTargets}/${summary.totalTargets} up`}
        </span>
      </div>

      {/* Active alerts list */}
      {visibleAlerts.map((alert) => (
        <NavItem
          key={alert.fingerprint}
          item={{
            id: alert.fingerprint,
            label: alert.alertname,
            variant: 'item' as const,
            meta: (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: SEVERITY_COLORS[alert.severity ?? ''] ?? 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {alert.severity ?? 'alert'}
              </span>
            ),
          }}
          onSelect={() => handleAlertClick(alert)}
        />
      ))}

      {/* Overflow indicator */}
      {(summary?.alertCount ?? 0) > 5 && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            padding: '2px 12px 4px',
            cursor: 'pointer',
          }}
          onClick={() => handleOpenDrawer('alerts')}
        >
          +{(summary?.alertCount ?? 0) - 5} more alerts
        </div>
      )}

      {/* Quick-access nav items */}
      <NavItem
        item={{ id: 'metrics', label: 'Metrics', variant: 'item' as const }}
        onSelect={() => handleOpenDrawer('metrics')}
      />
      <NavItem
        item={{ id: 'logs', label: 'Logs', variant: 'item' as const }}
        onSelect={() => handleOpenDrawer('logs')}
      />
    </NavSection>
  );
}
