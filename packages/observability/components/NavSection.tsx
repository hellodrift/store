/**
 * Observability NavSection — hierarchical sidebar.
 *
 * Three collapsible folders inside the main section:
 *   Alerts  → active alerts (click to open alert entity drawer)
 *   Metrics → Prometheus scrape jobs with per-job health dot
 *   Logs    → Loki services (click pre-filters the Logs tab)
 */

import { useState } from 'react';
import { NavSection, NavItem, NavSettingsButton, NavHeaderActions, BellIcon, WorkstreamBarsIcon, TerminalIcon, ShieldIcon } from '@drift/ui';
import { useEntityQuery, useEntityDrawer, buildEntityURI, gql } from '@drift/plugin-api';

// ─── Queries ──────────────────────────────────────────────────────────────────

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
    }
  }
`;

const OBS_NAV_TARGETS = gql`
  query ObsNavTargets {
    obsTargets {
      job
      health
    }
  }
`;

const OBS_LOKI_SERVICES = gql`
  query ObsNavLokiServices {
    obsLokiLabelValues(label: "service")
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────────

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
}

interface ObsTarget {
  job: string;
  health: string;
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

// ─── Persistent expand state ──────────────────────────────────────────────────

const STORAGE_KEY = 'drift-plugin:observability:nav-expanded';
const DEFAULT_EXPANDED = { alerts: true, metrics: true, logs: true };

function readExpanded() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULT_EXPANDED, ...JSON.parse(stored) } : DEFAULT_EXPANDED;
  } catch {
    return DEFAULT_EXPANDED;
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ObsNavSection({ onSelect }: Props) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [sectExpanded, setSectExpanded] = useState(readExpanded);
  const { openEntityDrawer } = useEntityDrawer();

  const toggle = (key: keyof typeof sectExpanded) => {
    setSectExpanded((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const { data: summaryData, loading: summaryLoading } = useEntityQuery(OBS_SUMMARY, {
    pollInterval: 30_000,
    fetchPolicy: 'cache-and-network',
  });

  const { data: alertsData } = useEntityQuery(OBS_ALERTS, {
    pollInterval: 30_000,
    fetchPolicy: 'cache-and-network',
    skip: !sectExpanded.alerts,
  });

  const { data: targetsData } = useEntityQuery(OBS_NAV_TARGETS, {
    pollInterval: 60_000,
    fetchPolicy: 'cache-and-network',
    skip: !sectExpanded.metrics,
  });

  const { data: servicesData } = useEntityQuery(OBS_LOKI_SERVICES, {
    pollInterval: 120_000,
    fetchPolicy: 'cache-and-network',
    skip: !sectExpanded.logs,
  });

  const summary: ObsSummary | undefined = summaryData?.obsSummary;
  const activeAlerts: ObsAlert[] = (alertsData?.obsAlerts ?? []).filter((a: ObsAlert) => a.state === 'active');

  // Deduplicate scrape targets by job, compute per-job health
  const targets: ObsTarget[] = targetsData?.obsTargets ?? [];
  const jobMap = new Map<string, boolean>(); // job → allUp
  for (const t of targets) {
    const prev = jobMap.get(t.job);
    jobMap.set(t.job, prev === undefined ? t.health === 'up' : prev && t.health === 'up');
  }
  const jobs = Array.from(jobMap.entries()); // [job, allUp][]

  const services: string[] = servicesData?.obsLokiLabelValues ?? [];

  const section = {
    id: 'observability',
    label: 'Observability',
    icon: <ShieldIcon size={12} />,
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

  return (
    <NavSection
      section={section}
      isExpanded={isExpanded}
      onToggle={(_, expanded) => setIsExpanded(expanded)}
    >
      {/* ── Alerts ─────────────────────────────────────────────────────────── */}
      <NavItem
        item={{
          id: 'alerts',
          label: 'Alerts',
          variant: 'folder' as const,
          icon: <BellIcon size={12} />,
          meta: activeAlerts.length > 0
            ? (
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                color: activeAlerts.some((a) => a.severity === 'critical')
                  ? 'var(--status-error)'
                  : 'var(--status-warning)',
              }}>
                {activeAlerts.length}
              </span>
            )
            : undefined,
        }}
        isExpanded={sectExpanded.alerts}
        onToggle={() => toggle('alerts')}
        depth={0}
      >
        {activeAlerts.length === 0 ? (
          <NavItem
            item={{ id: 'alerts-empty', label: 'No active alerts', variant: 'item' as const }}
            depth={1}
          />
        ) : (
          activeAlerts.map((alert) => (
            <NavItem
              key={alert.fingerprint}
              item={{
                id: alert.fingerprint,
                label: alert.alertname,
                variant: 'item' as const,
                meta: (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: SEVERITY_COLORS[alert.severity ?? ''] ?? 'var(--text-muted)',
                  }}>
                    {alert.severity ?? 'alert'}
                  </span>
                ),
              }}
              depth={1}
              onSelect={() => openEntityDrawer(buildEntityURI('active_alert', alert.fingerprint, alert.alertname))}
            />
          ))
        )}
      </NavItem>

      {/* ── Metrics ────────────────────────────────────────────────────────── */}
      <NavItem
        item={{
          id: 'metrics',
          label: 'Metrics',
          variant: 'folder' as const,
          icon: <WorkstreamBarsIcon size={12} />,
          meta: summary
            ? (
              <span style={{
                fontSize: 10,
                color: summary.allHealthy ? 'var(--status-success, #30a46c)' : 'var(--status-error)',
              }}>
                {summary.healthyTargets}/{summary.totalTargets}
              </span>
            )
            : undefined,
        }}
        isExpanded={sectExpanded.metrics}
        onToggle={() => toggle('metrics')}
        depth={0}
      >
        {jobs.length === 0 ? (
          <NavItem
            item={{ id: 'metrics-empty', label: targets.length === 0 ? 'Loading…' : 'No targets', variant: 'item' as const }}
            depth={1}
          />
        ) : (
          jobs.map(([job, allUp]) => (
            <NavItem
              key={job}
              item={{
                id: `metrics-${job}`,
                label: job,
                variant: 'item' as const,
                meta: (
                  <span style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: allUp ? 'var(--status-success, #30a46c)' : 'var(--status-error)',
                    boxShadow: `0 0 3px ${allUp ? 'var(--status-success, #30a46c)' : 'var(--status-error)'}`,
                    flexShrink: 0,
                  }} />
                ),
              }}
              depth={1}
              onSelect={() => openEntityDrawer(buildEntityURI('service_metrics', job, job))}
            />
          ))
        )}
      </NavItem>

      {/* ── Logs ───────────────────────────────────────────────────────────── */}
      <NavItem
        item={{
          id: 'logs',
          label: 'Logs',
          variant: 'folder' as const,
          icon: <TerminalIcon size={12} />,
          meta: services.length > 0
            ? <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{services.length}</span>
            : undefined,
        }}
        isExpanded={sectExpanded.logs}
        onToggle={() => toggle('logs')}
        depth={0}
      >
        {services.length === 0 ? (
          <NavItem
            item={{ id: 'logs-empty', label: 'No services found', variant: 'item' as const }}
            depth={1}
          />
        ) : (
          services.map((svc) => (
            <NavItem
              key={svc}
              item={{ id: `logs-${svc}`, label: svc, variant: 'item' as const }}
              depth={1}
              onSelect={() => openEntityDrawer(buildEntityURI('service_logs', svc, svc))}
            />
          ))
        )}
      </NavItem>
    </NavSection>
  );
}
