/**
 * MetricsDrawer — Entity drawer for service_metrics entities.
 *
 * Features:
 *   - Time range selector: 15m / 1h / 6h / 24h
 *   - Auto-refresh: Off / 30s / 1m / 5m
 *   - Per-panel query builder:
 *       • Metric picker (autocomplete from Prometheus label __name__)
 *       • Label filters with key/op/value autocomplete from Prometheus API
 *       • Range function: rate / irate / increase / avg_over_time / etc.
 *       • Range interval: 30s → 1h
 *       • Aggregation: sum / avg / min / max / count with "by (labels)"
 *       • Toggle to raw PromQL editor
 *   - recharts line charts with auto-scaled axes
 */

import { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { useEntityQuery, gql } from '@drift/plugin-api';
import { ContentProvider, DrawerBody } from '@drift/ui';
import React from 'react';

// ─── GraphQL ──────────────────────────────────────────────────────────────

const OBS_JOB_TARGETS = gql`
  query MetricsJobTargets($job: String!) {
    obsJobTargets(job: $job) { instance health lastError }
  }
`;
const OBS_QUERY_RANGE = gql`
  query MetricsQueryRange($query: String!, $start: String, $end: String, $step: String) {
    obsQueryRange(query: $query, start: $start, end: $end, step: $step) { metric values }
  }
`;
const OBS_METRIC_NAMES = gql`
  query MetricNames($job: String) { obsMetricNames(job: $job) }
`;
const OBS_LABEL_NAMES = gql`
  query PromLabelNames($metricName: String, $job: String) {
    obsPromLabelNames(metricName: $metricName, job: $job)
  }
`;
const OBS_LABEL_VALUES = gql`
  query PromLabelValues($label: String!, $metricName: String, $job: String) {
    obsPromLabelValues(label: $label, metricName: $metricName, job: $job)
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────

interface DrawerProps {
  entityId: string; entityType: string; label?: string;
  drawer: { close: () => void; push: (uri: string) => void; pop: () => void; canPop: boolean };
  pluginId: string;
}

type LabelOp = '=' | '!=' | '=~' | '!~';
interface LabelFilter { id: string; key: string; op: LabelOp; value: string }

interface PanelConfig {
  id: string;
  title: string;
  mode: 'builder' | 'raw';
  // builder fields
  metricName: string;
  labelFilters: LabelFilter[];
  rangeFn: string;
  rangeInterval: string;
  aggFn: string;
  aggBy: string[];
  // raw field
  rawQuery: string;
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
  { label: '30s', seconds: 30 },
  { label: '1m',  seconds: 60 },
  { label: '5m',  seconds: 300 },
] as const;

const RANGE_FNS = [
  { label: 'None',           value: '' },
  { label: 'rate',           value: 'rate' },
  { label: 'irate',          value: 'irate' },
  { label: 'increase',       value: 'increase' },
  { label: 'delta',          value: 'delta' },
  { label: 'avg_over_time',  value: 'avg_over_time' },
  { label: 'max_over_time',  value: 'max_over_time' },
  { label: 'min_over_time',  value: 'min_over_time' },
  { label: 'sum_over_time',  value: 'sum_over_time' },
];

const INTERVALS = ['15s', '30s', '1m', '2m', '5m', '10m', '15m', '30m', '1h'];

const AGG_FNS = [
  { label: 'None',  value: '' },
  { label: 'sum',   value: 'sum' },
  { label: 'avg',   value: 'avg' },
  { label: 'min',   value: 'min' },
  { label: 'max',   value: 'max' },
  { label: 'count', value: 'count' },
];

const LABEL_OPS: LabelOp[] = ['=', '!=', '=~', '!~'];

const LINE_COLORS = [
  'var(--brand-primary)', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
];

const DEFAULT_PANELS: PanelConfig[] = [
  {
    id: 'up', title: 'Target Health', mode: 'builder',
    metricName: 'up', labelFilters: [],
    rangeFn: '', rangeInterval: '5m', aggFn: '', aggBy: [], rawQuery: '',
  },
  {
    id: 'cpu', title: 'CPU Usage', mode: 'builder',
    metricName: 'process_cpu_seconds_total', labelFilters: [],
    rangeFn: 'rate', rangeInterval: '5m', aggFn: '', aggBy: [], rawQuery: '',
  },
  {
    id: 'memory', title: 'Memory Usage', mode: 'builder',
    metricName: 'process_resident_memory_bytes', labelFilters: [],
    rangeFn: '', rangeInterval: '5m', aggFn: '', aggBy: [], rawQuery: '',
  },
  {
    id: 'http_req', title: 'HTTP Request Rate', mode: 'builder',
    metricName: 'http_requests_total', labelFilters: [],
    rangeFn: 'rate', rangeInterval: '5m', aggFn: 'sum', aggBy: ['status_code'], rawQuery: '',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function computeStep(rangeMinutes: number): string {
  return `${Math.max(15, Math.ceil(rangeMinutes * 60 / 200))}s`;
}

function buildPromQL(cfg: PanelConfig, job: string): string {
  if (cfg.mode === 'raw') return cfg.rawQuery;
  if (!cfg.metricName) return '';

  const filters = [`job="${job}"`];
  cfg.labelFilters.forEach(f => {
    if (f.key && f.value) filters.push(`${f.key}${f.op}"${f.value.replace(/"/g, '\\"')}"`);
  });

  let expr = `${cfg.metricName}{${filters.join(', ')}}`;
  if (cfg.rangeFn && cfg.rangeInterval) {
    expr = `${cfg.rangeFn}(${expr}[${cfg.rangeInterval}])`;
  }
  if (cfg.aggFn) {
    const by = cfg.aggBy.length ? ` by (${cfg.aggBy.join(', ')})` : '';
    expr = `${cfg.aggFn}(${expr})${by}`;
  }
  return expr;
}

function formatValue(v: number, promql: string): string {
  if (promql.includes('_bytes')) {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}GB`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}MB`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}KB`;
    return `${v.toFixed(0)}B`;
  }
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(2);
  return v.toFixed(v < 10 ? 4 : 2);
}

// ─── LabelFilterRow ───────────────────────────────────────────────────────
// Separate component so useEntityQuery for value autocomplete follows hook rules

function LabelFilterRow({ panelId, filter, labelNames, job, metricName, onChange, onRemove }: {
  panelId: string;
  filter: LabelFilter;
  labelNames: string[];
  job: string;
  metricName: string;
  onChange: (f: LabelFilter) => void;
  onRemove: () => void;
}) {
  const keyListId = `kl-${panelId}-${filter.id}`;
  const valListId = `vl-${panelId}-${filter.id}`;

  const { data: valData } = useEntityQuery(OBS_LABEL_VALUES, {
    variables: { label: filter.key, metricName: metricName || undefined, job },
    skip: !filter.key,
    fetchPolicy: 'cache-first',
  });
  const values: string[] = valData?.obsPromLabelValues ?? [];

  return (
    <div style={S.filterRow}>
      <input
        style={S.filterKey}
        list={keyListId}
        value={filter.key}
        placeholder="label"
        onChange={e => onChange({ ...filter, key: e.target.value })}
      />
      <datalist id={keyListId}>{labelNames.map(l => <option key={l} value={l} />)}</datalist>

      <select style={S.filterOp} value={filter.op} onChange={e => onChange({ ...filter, op: e.target.value as LabelOp })}>
        {LABEL_OPS.map(op => <option key={op} value={op}>{op}</option>)}
      </select>

      <input
        style={S.filterVal}
        list={valListId}
        value={filter.value}
        placeholder="value"
        onChange={e => onChange({ ...filter, value: e.target.value })}
      />
      <datalist id={valListId}>{values.map(v => <option key={v} value={v} />)}</datalist>

      <button style={S.filterRemove} onClick={onRemove}>×</button>
    </div>
  );
}

// ─── QueryEditor ──────────────────────────────────────────────────────────

function QueryEditor({ job, cfg, onChange }: {
  job: string;
  cfg: PanelConfig;
  onChange: (c: PanelConfig) => void;
}) {
  const metricListId = `metric-${cfg.id}`;

  const { data: metricData } = useEntityQuery(OBS_METRIC_NAMES, {
    variables: { job },
    fetchPolicy: 'cache-first',
  });
  const metricNames: string[] = metricData?.obsMetricNames ?? [];

  const { data: labelData } = useEntityQuery(OBS_LABEL_NAMES, {
    variables: { metricName: cfg.metricName || undefined, job },
    skip: !cfg.metricName,
    fetchPolicy: 'cache-first',
  });
  const labelNames: string[] = labelData?.obsPromLabelNames ?? [];

  const addFilter = () => onChange({
    ...cfg,
    labelFilters: [...cfg.labelFilters, { id: `${Date.now()}`, key: '', op: '=', value: '' }],
  });

  const updateFilter = (id: string, updated: LabelFilter) => onChange({
    ...cfg,
    labelFilters: cfg.labelFilters.map(f => f.id === id ? updated : f),
  });

  const removeFilter = (id: string) => onChange({
    ...cfg,
    labelFilters: cfg.labelFilters.filter(f => f.id !== id),
  });

  const toggleAggBy = (label: string) => {
    const next = cfg.aggBy.includes(label)
      ? cfg.aggBy.filter(l => l !== label)
      : [...cfg.aggBy, label];
    onChange({ ...cfg, aggBy: next });
  };

  if (cfg.mode === 'raw') {
    return (
      <div style={S.editor}>
        <div style={S.editorSec}>
          <div style={S.editorSecHeader}>
            <span style={S.editorLabel}>PromQL</span>
            <button style={S.modeBtn} onClick={() => onChange({ ...cfg, mode: 'builder' })}>
              ← Builder
            </button>
          </div>
          <textarea
            style={S.rawTextarea}
            value={cfg.rawQuery}
            onChange={e => onChange({ ...cfg, rawQuery: e.target.value })}
            placeholder="Enter PromQL expression…"
            rows={3}
            spellCheck={false}
          />
        </div>
      </div>
    );
  }

  const generated = buildPromQL(cfg, job);

  return (
    <div style={S.editor}>
      {/* Metric */}
      <div style={S.editorSec}>
        <span style={S.editorLabel}>Metric</span>
        <input
          style={S.metricInput}
          list={metricListId}
          value={cfg.metricName}
          placeholder="metric name…"
          onChange={e => {
            const m = e.target.value;
            const autoTitle = m.replace(/_total$|_seconds$|_bytes$/, '').replace(/_/g, ' ');
            onChange({ ...cfg, metricName: m, title: autoTitle || cfg.title });
          }}
        />
        <datalist id={metricListId}>{metricNames.map(m => <option key={m} value={m} />)}</datalist>
      </div>

      {/* Label filters */}
      <div style={S.editorSec}>
        <div style={S.editorSecHeader}>
          <span style={S.editorLabel}>Filters</span>
          <span style={S.autoFilter}>job="{job}"</span>
        </div>
        {cfg.labelFilters.map(f => (
          <LabelFilterRow
            key={f.id}
            panelId={cfg.id}
            filter={f}
            labelNames={labelNames}
            job={job}
            metricName={cfg.metricName}
            onChange={updated => updateFilter(f.id, updated)}
            onRemove={() => removeFilter(f.id)}
          />
        ))}
        <button style={S.addFilterBtn} onClick={addFilter}>+ Add filter</button>
      </div>

      {/* Range function */}
      <div style={S.editorSec}>
        <span style={S.editorLabel}>Function</span>
        <div style={S.editorRow}>
          <select style={S.select} value={cfg.rangeFn} onChange={e => onChange({ ...cfg, rangeFn: e.target.value })}>
            {RANGE_FNS.map(fn => <option key={fn.value} value={fn.value}>{fn.label}</option>)}
          </select>
          {cfg.rangeFn && (
            <>
              <span style={S.editorText}>over</span>
              <select style={S.select} value={cfg.rangeInterval} onChange={e => onChange({ ...cfg, rangeInterval: e.target.value })}>
                {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      {/* Aggregation */}
      <div style={S.editorSec}>
        <span style={S.editorLabel}>Aggregation</span>
        <div style={S.editorRow}>
          <select style={S.select} value={cfg.aggFn} onChange={e => onChange({ ...cfg, aggFn: e.target.value })}>
            {AGG_FNS.map(fn => <option key={fn.value} value={fn.value}>{fn.label}</option>)}
          </select>
          {cfg.aggFn && labelNames.length > 0 && (
            <>
              <span style={S.editorText}>by</span>
              <div style={S.byRow}>
                {cfg.aggBy.map(l => (
                  <span key={l} style={S.byChip}>
                    {l}
                    <button style={S.chipX} onClick={() => toggleAggBy(l)}>×</button>
                  </span>
                ))}
                <select
                  style={{ ...S.select, maxWidth: 110 }}
                  value=""
                  onChange={e => { if (e.target.value) { toggleAggBy(e.target.value); e.target.value = ''; } }}
                >
                  <option value="">+ label</option>
                  {labelNames.filter(l => !cfg.aggBy.includes(l)).map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* PromQL preview + raw toggle */}
      <div style={S.promqlBar}>
        <code style={S.promqlCode}>{generated || '(select a metric)'}</code>
        <button
          style={S.modeBtn}
          onClick={() => onChange({ ...cfg, mode: 'raw', rawQuery: generated })}
          title="Edit as raw PromQL"
        >
          PromQL →
        </button>
      </div>
    </div>
  );
}

// ─── MetricChart ──────────────────────────────────────────────────────────

function MetricChart({ promql, startISO, endISO, step }: {
  promql: string; startISO: string; endISO: string; step: string;
}) {
  const { data, loading } = useEntityQuery(OBS_QUERY_RANGE, {
    variables: { query: promql, start: startISO, end: endISO, step },
    fetchPolicy: 'cache-and-network',
    skip: !promql,
  });

  const series = useMemo(() => {
    const raw: any[] = data?.obsQueryRange ?? [];
    return raw.map((ts, idx) => {
      let label = '';
      try {
        const lbls = JSON.parse(ts.metric);
        const parts = Object.entries(lbls).filter(([k]) => k !== '__name__').map(([k, v]) => `${k}="${v}"`).join(', ');
        label = parts || (lbls.__name__ as string) || '';
      } catch {}
      const chartData = (ts.values ?? [])
        .map(([t, v]: [string, string]) => ({ t: parseFloat(t) * 1000, v: parseFloat(v) }))
        .filter((d: { t: number; v: number }) => !isNaN(d.v));
      return { label, data: chartData, color: LINE_COLORS[idx % LINE_COLORS.length] };
    });
  }, [data]);

  if (loading && !data) return <div style={S.chartPlaceholder}>Loading…</div>;
  if (!promql) return <div style={S.chartPlaceholder}>Select a metric above</div>;
  if (!series.some(s => s.data.length > 0)) return <div style={S.chartPlaceholder}>No data</div>;

  const timeSet = new Set<number>();
  series.forEach(s => s.data.forEach(d => timeSet.add(d.t)));
  const times = Array.from(timeSet).sort((a, b) => a - b);
  const merged = times.map(t => {
    const pt: Record<string, any> = { t };
    series.forEach((s, i) => { const m = s.data.find(d => d.t === t); if (m) pt[`v${i}`] = m.v; });
    return pt;
  });

  const tickFmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div>
      {series.length > 1 && (
        <div style={S.legend}>
          {series.map((s, i) => (
            <span key={i} style={S.legendItem}>
              <span style={{ ...S.legendLine, background: s.color }} />
              {s.label || `series ${i + 1}`}
            </span>
          ))}
        </div>
      )}
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={merged} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-muted)" />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time"
            tickFormatter={tickFmt} tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            axisLine={false} tickLine={false} minTickGap={50} />
          <YAxis tickFormatter={(v: number) => formatValue(v, promql)}
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            axisLine={false} tickLine={false} width={54} />
          <Tooltip
            contentStyle={S.tooltipContent}
            labelFormatter={(ms: any) => new Date(Number(ms)).toLocaleTimeString()}
            formatter={(value: any) => [formatValue(Number(value), promql), '']}
          />
          {series.map((s, i) => (
            <Line key={i} type="monotone" dataKey={`v${i}`} stroke={s.color}
              dot={false} strokeWidth={1.5} connectNulls={false} name={s.label} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── PanelCard ────────────────────────────────────────────────────────────

function PanelCard({ job, cfg, onChange, onRemove, startISO, endISO, step }: {
  job: string;
  cfg: PanelConfig;
  onChange: (c: PanelConfig) => void;
  onRemove: () => void;
  startISO: string; endISO: string; step: string;
}) {
  const [editing, setEditing] = useState(!cfg.metricName);
  const promql = buildPromQL(cfg, job);

  return (
    <div style={S.panel}>
      <div style={S.panelHeader}>
        <span style={S.panelTitle}>{cfg.title || cfg.metricName || 'New Panel'}</span>
        <div style={S.panelBtns}>
          <button style={S.editBtn} onClick={() => setEditing(e => !e)} title={editing ? 'Collapse editor' : 'Edit query'}>
            {editing ? '▲' : '⚙'}
          </button>
          <button style={S.removeBtn} onClick={onRemove} title="Remove panel">×</button>
        </div>
      </div>
      {editing && <QueryEditor job={job} cfg={cfg} onChange={onChange} />}
      <MetricChart promql={promql} startISO={startISO} endISO={endISO} step={step} />
    </div>
  );
}

// ─── Target Health Badge ──────────────────────────────────────────────────

function TargetHealthBadge({ job }: { job: string }) {
  const { data } = useEntityQuery(OBS_JOB_TARGETS, {
    variables: { job }, pollInterval: 30_000, fetchPolicy: 'cache-and-network',
  });
  const targets: any[] = data?.obsJobTargets ?? [];
  if (!targets.length) return null;
  const up = targets.filter(t => t.health === 'up').length;
  const allUp = up === targets.length;
  const color = allUp ? 'var(--status-success, #30a46c)' : 'var(--status-error)';
  return (
    <span style={{ ...S.healthBadge, color }}>
      <span style={{ ...S.healthDot, background: color }} />
      {up}/{targets.length} targets up
    </span>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function MetricsDrawer({ entityId: job }: DrawerProps) {
  const [rangeIdx, setRangeIdx] = useState(1);
  const [refreshIdx, setRefreshIdx] = useState(0);
  const [panels, setPanels] = useState<PanelConfig[]>(DEFAULT_PANELS);
  const [tick, setTick] = useState(0);

  const range = TIME_RANGES[rangeIdx];
  const refreshOpt = REFRESH_OPTIONS[refreshIdx];

  const endISO   = useMemo(() => new Date().toISOString(), [tick, rangeIdx]);
  const startISO = useMemo(() => new Date(Date.now() - range.minutes * 60_000).toISOString(), [tick, rangeIdx]);
  const step     = useMemo(() => computeStep(range.minutes), [rangeIdx]);

  useEffect(() => {
    if (refreshOpt.seconds === 0) return;
    const id = setInterval(() => setTick(t => t + 1), refreshOpt.seconds * 1000);
    return () => clearInterval(id);
  }, [refreshOpt.seconds]);

  const updatePanel = (id: string, updated: PanelConfig) =>
    setPanels(prev => prev.map(p => p.id === id ? updated : p));

  const removePanel = (id: string) =>
    setPanels(prev => prev.filter(p => p.id !== id));

  const addPanel = () => setPanels(prev => [...prev, {
    id: `panel-${Date.now()}`, title: 'New Panel', mode: 'builder',
    metricName: '', labelFilters: [], rangeFn: '', rangeInterval: '5m',
    aggFn: '', aggBy: [], rawQuery: '',
  }]);

  return (
    <ContentProvider density="compact">
      <DrawerBody>
        {/* Header */}
        <div style={S.header}>
          <div style={S.jobName}>{job}</div>
          <TargetHealthBadge job={job} />
        </div>

        {/* Time range + refresh */}
        <div style={S.controls}>
          <div style={S.controlRow}>
            {TIME_RANGES.map((r, i) => (
              <button key={r.label} style={{ ...S.pill, ...(i === rangeIdx ? S.pillActive : {}) }} onClick={() => setRangeIdx(i)}>
                {r.label}
              </button>
            ))}
          </div>
          <div style={S.controlRow}>
            <span style={S.ctrlLabel}>Refresh:</span>
            {REFRESH_OPTIONS.map((opt, i) => (
              <button key={opt.label} style={{ ...S.pill, ...(i === refreshIdx ? S.pillActive : {}) }} onClick={() => setRefreshIdx(i)}>
                {opt.label}
              </button>
            ))}
            <button style={S.refreshNowBtn} onClick={() => setTick(t => t + 1)} title="Refresh now">↻</button>
          </div>
        </div>

        {/* Panels */}
        {panels.map(panel => (
          <PanelCard
            key={panel.id}
            job={job}
            cfg={panel}
            onChange={updated => updatePanel(panel.id, updated)}
            onRemove={() => removePanel(panel.id)}
            startISO={startISO} endISO={endISO} step={step}
          />
        ))}

        {/* Add panel */}
        <div style={S.addSection}>
          <button style={S.addPanelBtn} onClick={addPanel}>+ Add panel</button>
        </div>
      </DrawerBody>
    </ContentProvider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const S = {
  header: { padding: '12px 16px 8px', borderBottom: '1px solid var(--border-muted)' },
  jobName: { fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 },
  healthBadge: { display: 'inline-flex', alignItems: 'center', fontSize: 12 },
  healthDot: { width: 6, height: 6, borderRadius: '50%', marginRight: 5, flexShrink: 0 } as React.CSSProperties,

  controls: { padding: '8px 16px', display: 'flex', flexDirection: 'column' as const, gap: 6, borderBottom: '1px solid var(--border-muted)' },
  controlRow: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' as const },
  ctrlLabel: { fontSize: 11, color: 'var(--text-muted)', marginRight: 2 },
  pill: { padding: '2px 8px', fontSize: 11, borderRadius: 12, border: '1px solid var(--border-muted)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', lineHeight: '18px' } as React.CSSProperties,
  pillActive: { background: 'var(--brand-primary)', color: '#fff', borderColor: 'var(--brand-primary)' } as React.CSSProperties,
  refreshNowBtn: { padding: '2px 6px', fontSize: 14, borderRadius: 4, border: '1px solid var(--border-muted)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', lineHeight: '18px' } as React.CSSProperties,

  panel: { borderBottom: '1px solid var(--border-muted)' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 6px' },
  panelTitle: { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  panelBtns: { display: 'flex', gap: 4 },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, padding: '0 4px', opacity: 0.7 } as React.CSSProperties,
  removeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: '0 4px', opacity: 0.6 } as React.CSSProperties,

  editor: { margin: '0 16px 8px', padding: '10px 12px', background: 'var(--surface-subtle)', borderRadius: 8, display: 'flex', flexDirection: 'column' as const, gap: 10 },
  editorSec: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  editorSecHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  editorLabel: { fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  autoFilter: { fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' as const },
  editorRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  editorText: { fontSize: 11, color: 'var(--text-muted)' },

  metricInput: { width: '100%', padding: '4px 8px', fontSize: 12, borderRadius: 5, border: '1px solid var(--border-muted)', background: 'var(--surface-elevated)', color: 'var(--text-primary)', outline: 'none' } as React.CSSProperties,

  filterRow: { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 },
  filterKey: { width: 90, padding: '3px 6px', fontSize: 11, borderRadius: 4, border: '1px solid var(--border-muted)', background: 'var(--surface-elevated)', color: 'var(--text-primary)', outline: 'none' } as React.CSSProperties,
  filterOp: { padding: '3px 4px', fontSize: 11, borderRadius: 4, border: '1px solid var(--border-muted)', background: 'var(--surface-elevated)', color: 'var(--text-secondary)', cursor: 'pointer', outline: 'none' } as React.CSSProperties,
  filterVal: { flex: 1, minWidth: 0, padding: '3px 6px', fontSize: 11, borderRadius: 4, border: '1px solid var(--border-muted)', background: 'var(--surface-elevated)', color: 'var(--text-primary)', outline: 'none' } as React.CSSProperties,
  filterRemove: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0 } as React.CSSProperties,

  addFilterBtn: { padding: '3px 8px', fontSize: 11, borderRadius: 4, background: 'transparent', border: '1px dashed var(--border-muted)', color: 'var(--text-muted)', cursor: 'pointer', alignSelf: 'flex-start' as const } as React.CSSProperties,

  select: { padding: '3px 6px', fontSize: 11, borderRadius: 4, border: '1px solid var(--border-muted)', background: 'var(--surface-elevated)', color: 'var(--text-secondary)', cursor: 'pointer', outline: 'none' } as React.CSSProperties,

  byRow: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' as const },
  byChip: { display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 6px', fontSize: 11, borderRadius: 10, background: 'var(--brand-primary)', color: '#fff' } as React.CSSProperties,
  chipX: { background: 'none', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 13, lineHeight: 1, padding: 0, opacity: 0.8 } as React.CSSProperties,

  promqlBar: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'var(--surface-page)', borderRadius: 5, border: '1px solid var(--border-muted)' },
  promqlCode: { flex: 1, fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  modeBtn: { padding: '2px 8px', fontSize: 10, borderRadius: 4, background: 'transparent', border: '1px solid var(--border-muted)', color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 } as React.CSSProperties,

  rawTextarea: { width: '100%', padding: '6px 8px', fontSize: 11, borderRadius: 5, border: '1px solid var(--border-muted)', background: 'var(--surface-elevated)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace', resize: 'vertical' as const, boxSizing: 'border-box' as const } as React.CSSProperties,

  chartPlaceholder: { height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' as const, padding: '0 16px' },
  legend: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 4, padding: '0 16px' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-secondary)' } as React.CSSProperties,
  legendLine: { width: 10, height: 2, display: 'inline-block', borderRadius: 1, flexShrink: 0 } as React.CSSProperties,
  tooltipContent: { background: 'var(--surface-elevated)', border: '1px solid var(--border-muted)', borderRadius: 6, fontSize: 11, color: 'var(--text-primary)' } as React.CSSProperties,

  addSection: { padding: '12px 16px' },
  addPanelBtn: { padding: '6px 12px', fontSize: 12, borderRadius: 6, background: 'transparent', border: '1px dashed var(--border-muted)', color: 'var(--text-muted)', cursor: 'pointer', width: '100%', textAlign: 'center' as const } as React.CSSProperties,
};
