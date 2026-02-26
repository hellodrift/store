/**
 * LogsDrawer — Entity drawer for service_logs entities.
 *
 * Opens when a Loki service is clicked in the nav sidebar.
 *
 * Features:
 *   - Tabs: Logs (all) | Errors (pre-filtered error/fatal)
 *   - Time range selector: 15m / 1h / 6h / 24h
 *   - Level filter: all / debug / info / warn / error / fatal
 *   - Text search with 400ms debounce
 *   - Auto-refresh: Off / 10s / 30s / 1m
 *   - Color-coded level badges
 */

import { useState, useEffect, useMemo } from 'react';
import { useEntityQuery, usePluginStorage, useDebounce, gql } from '@drift/plugin-api';
import { ContentProvider, DrawerBody } from '@drift/ui';

// ─── GraphQL ──────────────────────────────────────────────────────────────

const OBS_LOGS = gql`
  query LogsDrawerQuery($logql: String!, $limit: Int, $since: String) {
    obsLogs(logql: $logql, limit: $limit, since: $since) {
      timestamp
      service
      level
      message
      labels
    }
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────

interface DrawerProps {
  entityId: string;
  entityType: string;
  label?: string;
  drawer: {
    close: () => void;
    push: (uri: string) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

interface LogLine {
  timestamp: string;
  service: string;
  level: string;
  message: string;
  labels: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const TIME_RANGES = [
  { label: '15m', minutes: 15 },
  { label: '1h',  minutes: 60 },
  { label: '6h',  minutes: 360 },
  { label: '24h', minutes: 1440 },
] as const;

const REFRESH_OPTIONS = [
  { label: 'Off', seconds: 0 },
  { label: '10s', seconds: 10 },
  { label: '30s', seconds: 30 },
  { label: '1m',  seconds: 60 },
] as const;

const LEVELS = ['all', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const LEVEL_STYLE: Record<string, { bg: string; color: string }> = {
  debug:   { bg: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)' },
  info:    { bg: 'rgba(14,165,233,0.12)',  color: '#0ea5e9' },
  warn:    { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b' },
  warning: { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b' },
  error:   { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444' },
  fatal:   { bg: 'rgba(153,27,27,0.15)',   color: '#991b1b' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildLogQL(service: string, level: string, search: string, errorsOnly: boolean): string {
  const selector = `{service="${service}"}`;
  const parts: string[] = [];

  // Line filter first (cheapest, no parsing needed)
  if (search.trim()) {
    const escaped = search.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    parts.push(`|= "${escaped}"`);
  }

  // Parser + label filter
  if (errorsOnly) {
    parts.push('| json', '| level=~"(?i)error|fatal"');
  } else if (level !== 'all') {
    parts.push('| json', `| level=~"(?i)${level}"`);
  }

  return selector + (parts.length ? ' ' + parts.join(' ') : '');
}

function levelStyle(level: string) {
  return LEVEL_STYLE[level.toLowerCase()] ?? { bg: 'rgba(148,163,184,0.1)', color: 'var(--text-muted)' };
}

function formatTimestamp(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : new Date(iso).toLocaleDateString();
}

// ─── Log Line Row ─────────────────────────────────────────────────────────

function LogRow({ line }: { line: LogLine }) {
  const ls = levelStyle(line.level);
  return (
    <div style={S.logRow}>
      <span style={S.logTs}>{formatTimestamp(line.timestamp)}</span>
      <span style={{ ...S.logLevel, background: ls.bg, color: ls.color }}>
        {(line.level || 'info').slice(0, 5).toUpperCase()}
      </span>
      <span style={S.logMsg}>{line.message}</span>
    </div>
  );
}

// ─── Log List ─────────────────────────────────────────────────────────────

function LogList({
  service,
  level,
  search,
  sinceISO,
  errorsOnly,
  limit,
}: {
  service: string;
  level: string;
  search: string;
  sinceISO: string;
  errorsOnly: boolean;
  limit: number;
}) {
  const logql = buildLogQL(service, level, search, errorsOnly);

  const { data, loading, error } = useEntityQuery(OBS_LOGS, {
    variables: { logql, limit, since: sinceISO },
    fetchPolicy: 'cache-and-network',
  });

  const lines: LogLine[] = data?.obsLogs ?? [];

  if (loading && !data) {
    return <div style={S.emptyState}>Loading…</div>;
  }

  if (error) {
    return (
      <div style={{ ...S.emptyState, color: 'var(--status-error)' }}>
        Query error — check LogQL syntax
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div style={S.emptyState}>
        {errorsOnly ? 'No errors in this time range' : 'No log lines found'}
      </div>
    );
  }

  return (
    <div style={S.logList}>
      {lines.map((line, i) => (
        <LogRow key={`${line.timestamp}-${i}`} line={line} />
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function LogsDrawer({ entityId: service }: DrawerProps) {
  const [defaultLogMinutes] = usePluginStorage('obs:defaultLogMinutes', 1440);
  const [activeTab, setActiveTab] = useState<'logs' | 'errors'>('logs');
  const [rangeIdx, setRangeIdx] = useState(() => {
    const mins = defaultLogMinutes ?? 1440;
    const idx = TIME_RANGES.findIndex(r => r.minutes === mins);
    return idx >= 0 ? idx : 3; // fall back to 24h
  });
  const [refreshIdx, setRefreshIdx] = useState(0); // default: Off
  const [level, setLevel] = useState('all');
  const [searchRaw, setSearchRaw] = useState('');
  const [tick, setTick] = useState(0);

  const search = useDebounce(searchRaw, 400);
  const range = TIME_RANGES[rangeIdx];
  const refreshOpt = REFRESH_OPTIONS[refreshIdx];

  const sinceISO = useMemo(
    () => new Date(Date.now() - range.minutes * 60_000).toISOString(),
    [tick, rangeIdx],
  );

  // Auto-refresh
  useEffect(() => {
    if (refreshOpt.seconds === 0) return;
    const id = setInterval(() => setTick(t => t + 1), refreshOpt.seconds * 1000);
    return () => clearInterval(id);
  }, [refreshOpt.seconds]);

  return (
    <ContentProvider density="compact">
      <DrawerBody>
        {/* ── Header ── */}
        <div style={S.header}>
          <div style={S.serviceName}>{service}</div>
          <div style={S.serviceLabel}>Loki service</div>
        </div>

        {/* ── Tabs ── */}
        <div style={S.tabs}>
          {(['logs', 'errors'] as const).map(tab => (
            <button
              key={tab}
              style={{ ...S.tab, ...(tab === activeTab ? S.tabActive : {}) }}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* ── Controls ── */}
        <div style={S.controls}>
          {/* Time range */}
          <div style={S.controlRow}>
            {TIME_RANGES.map((r, i) => (
              <button
                key={r.label}
                style={{ ...S.pill, ...(i === rangeIdx ? S.pillActive : {}) }}
                onClick={() => setRangeIdx(i)}
              >
                {r.label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <span style={S.refreshLabel}>↻</span>
            {REFRESH_OPTIONS.map((opt, i) => (
              <button
                key={opt.label}
                style={{ ...S.pill, ...(i === refreshIdx ? S.pillActive : {}) }}
                onClick={() => setRefreshIdx(i)}
              >
                {opt.label}
              </button>
            ))}
            <button
              style={S.refreshNowBtn}
              onClick={() => setTick(t => t + 1)}
              title="Refresh now"
            >
              ↻
            </button>
          </div>

          {/* Level + search (only on Logs tab) */}
          {activeTab === 'logs' && (
            <div style={S.controlRow}>
              <select
                style={S.levelSelect}
                value={level}
                onChange={e => setLevel(e.target.value)}
              >
                {LEVELS.map(l => (
                  <option key={l} value={l}>
                    {l === 'all' ? 'All levels' : l.charAt(0).toUpperCase() + l.slice(1)}
                  </option>
                ))}
              </select>
              <input
                style={S.searchInput}
                placeholder="Search logs…"
                value={searchRaw}
                onChange={e => setSearchRaw(e.target.value)}
              />
              {searchRaw && (
                <button style={S.clearBtn} onClick={() => setSearchRaw('')}>×</button>
              )}
            </div>
          )}
        </div>

        {/* ── Log Lines ── */}
        <LogList
          service={service}
          level={level}
          search={search}
          sinceISO={sinceISO}
          errorsOnly={activeTab === 'errors'}
          limit={200}
        />
      </DrawerBody>
    </ContentProvider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const S = {
  header: {
    padding: '12px 16px 8px',
    borderBottom: '1px solid var(--border-muted)',
  },
  serviceName: {
    fontWeight: 600,
    fontSize: 14,
    color: 'var(--text-primary)',
    marginBottom: 2,
  },
  serviceLabel: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--border-muted)',
    padding: '0 16px',
  },
  tab: {
    padding: '8px 12px',
    fontSize: 13,
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    marginBottom: -1,
  } as React.CSSProperties,
  tabActive: {
    color: 'var(--text-primary)',
    borderBottomColor: 'var(--brand-primary)',
    fontWeight: 500,
  } as React.CSSProperties,
  controls: {
    padding: '8px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    borderBottom: '1px solid var(--border-muted)',
  },
  controlRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap' as const,
  },
  pill: {
    padding: '2px 8px',
    fontSize: 11,
    borderRadius: 12,
    border: '1px solid var(--border-muted)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    lineHeight: '18px',
  } as React.CSSProperties,
  pillActive: {
    background: 'var(--brand-primary)',
    color: '#fff',
    borderColor: 'var(--brand-primary)',
  } as React.CSSProperties,
  refreshLabel: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  refreshNowBtn: {
    padding: '2px 6px',
    fontSize: 14,
    borderRadius: 4,
    border: '1px solid var(--border-muted)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    lineHeight: '18px',
  } as React.CSSProperties,
  levelSelect: {
    padding: '3px 6px',
    fontSize: 11,
    borderRadius: 6,
    border: '1px solid var(--border-muted)',
    background: 'var(--surface-elevated)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    outline: 'none',
  } as React.CSSProperties,
  searchInput: {
    flex: 1,
    padding: '3px 8px',
    fontSize: 12,
    borderRadius: 6,
    border: '1px solid var(--border-muted)',
    background: 'var(--surface-elevated)',
    color: 'var(--text-primary)',
    outline: 'none',
    minWidth: 0,
  } as React.CSSProperties,
  clearBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    fontSize: 16,
    lineHeight: 1,
    padding: '0 2px',
  } as React.CSSProperties,
  logList: {
    display: 'flex',
    flexDirection: 'column' as const,
    fontFamily: 'monospace',
    fontSize: 11,
    overflowY: 'auto' as const,
  },
  logRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '5px 16px',
    borderBottom: '1px solid var(--border-muted)',
    lineHeight: 1.4,
  } as React.CSSProperties,
  logTs: {
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    minWidth: 56,
  } as React.CSSProperties,
  logLevel: {
    padding: '1px 5px',
    borderRadius: 3,
    fontWeight: 600,
    fontSize: 10,
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  } as React.CSSProperties,
  logMsg: {
    color: 'var(--text-primary)',
    wordBreak: 'break-word' as const,
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,
  emptyState: {
    padding: 24,
    textAlign: 'center' as const,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontStyle: 'italic' as const,
  },
};

// Satisfy TS for React import used in type annotations
import React from 'react';
