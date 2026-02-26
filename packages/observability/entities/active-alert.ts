/**
 * active_alert entity — Firing Prometheus/Alertmanager alert.
 *
 * URI: @drift//active_alert/<fingerprint>
 *
 * Supports:
 *   - Workstream linking (incident → workstream)
 *   - silence action (POST to Alertmanager)
 *   - linkedContext (AI gets full alert context when referenced in chat)
 *   - Palette filters: severity, state
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';

// ─── Schema ───────────────────────────────────────────────────────────────

const activeAlertSchema = z.object({
  id: z.string(),             // fingerprint
  type: z.literal('active_alert'),
  uri: z.string(),
  alertname: z.string(),
  severity: z.string().optional(),
  state: z.string(),          // active | silenced | suppressed
  summary: z.string().optional(),
  description: z.string().optional(),
  labels: z.record(z.string()).optional(),
  startsAt: z.string(),
  duration: z.string().optional(),
  generatorURL: z.string().optional(),
  silencedBy: z.array(z.string()).optional(),
});

type ActiveAlert = z.infer<typeof activeAlertSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────

function getClient(ctx: EntityResolverContext): any {
  return (ctx as any).integrations?.observability?.client ?? null;
}

function humanDuration(startsAt: string): string {
  const ms = Date.now() - new Date(startsAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function alertToEntity(a: any): ActiveAlert {
  return {
    id: a.fingerprint,
    type: 'active_alert',
    uri: `@drift//active_alert/${a.fingerprint}`,
    alertname: a.labels?.alertname ?? 'unknown',
    severity: a.labels?.severity,
    state: a.status?.state ?? 'active',
    summary: a.annotations?.summary,
    description: a.annotations?.description,
    labels: a.labels,
    startsAt: a.startsAt,
    duration: humanDuration(a.startsAt),
    generatorURL: a.generatorURL,
    silencedBy: a.status?.silencedBy ?? [],
  };
}

async function fetchAlerts(alertmanagerUrl: string): Promise<any[]> {
  const res = await fetch(`${alertmanagerUrl}/api/v2/alerts`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Alertmanager HTTP ${res.status}`);
  return res.json();
}

// ─── Entity definition ────────────────────────────────────────────────────

export default defineEntity({
  type: 'active_alert',
  displayName: 'Alert',
  description: 'A firing or silenced alert from Prometheus/Alertmanager',
  icon: 'alert-triangle',

  schema: activeAlertSchema,

  uriPath: {
    segments: ['id'] as const,
    parse: (segments: string[]) => ({ id: segments[0] }),
    format: ({ id }: { id: string }) => id,
  },

  display: {
    emoji: '🚨',
    colors: {
      bg: '#e5484d',
      text: '#ffffff',
      border: '#c93a3f',
    },
    description: 'Firing Prometheus/Alertmanager alerts for incident tracking',
    filterDescriptions: [
      { name: 'severity', type: 'string', description: 'Filter by severity: critical, warning, info' },
      { name: 'state', type: 'string', description: 'Filter by state: active, silenced, suppressed' },
    ],
    outputFields: [
      { key: 'alertname', label: 'Alert', metadataPath: 'alertname', format: 'string' },
      { key: 'severity', label: 'Severity', metadataPath: 'severity', format: 'string' },
      { key: 'state', label: 'State', metadataPath: 'state', format: 'string' },
      { key: 'summary', label: 'Summary', metadataPath: 'summary', format: 'string' },
      { key: 'duration', label: 'Duration', metadataPath: 'duration', format: 'string' },
      { key: 'labels', label: 'Labels', metadataPath: 'labels', format: 'string' },
    ],
  },

  paletteFilters: [
    {
      key: 'severity',
      label: 'Severity',
      aliases: ['sev', 's'],
      values: [
        { id: 'critical', label: 'Critical', colorToken: 'error' },
        { id: 'warning', label: 'Warning', colorToken: 'warning' },
        { id: 'info', label: 'Info', colorToken: 'brand' },
      ],
    },
    {
      key: 'state',
      label: 'State',
      aliases: ['status'],
      values: [
        { id: 'active', label: 'Active', colorToken: 'error' },
        { id: 'silenced', label: 'Silenced', colorToken: 'muted' },
        { id: 'suppressed', label: 'Suppressed', colorToken: 'muted' },
      ],
    },
  ],

  integrations: { observability: 'observability' },

  cache: { ttl: 15_000, maxSize: 100 },

  actions: [
    {
      id: 'silence',
      label: 'Silence',
      description: 'Create an Alertmanager silence to suppress this alert',
      icon: 'bell-off',
      scope: 'instance',
      aiHint: 'Use to suppress a firing alert. durationMinutes is required: 15, 60, 240, or 1440 are common values. Silences the alert by matching on all its labels for precision.',
      inputSchema: z.object({
        durationMinutes: z.number().int().min(1).max(10080)
          .describe('Silence duration in minutes (15=15m, 60=1h, 240=4h, 1440=1d)'),
        comment: z.string().optional()
          .describe('Reason for silencing this alert'),
      }),
      handler: async (params: EntityActionParams<ActiveAlert>, ctx: EntityResolverContext): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No observability client configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as { durationMinutes: number; comment?: string };
        const alertLabels = params.entity.labels ?? { alertname: params.entity.alertname };

        const matchers = Object.entries(alertLabels).map(([name, value]) => ({
          name,
          value: String(value),
          isRegex: false,
        }));

        const endsAt = new Date(Date.now() + input.durationMinutes * 60_000).toISOString();
        const durationLabel = input.durationMinutes >= 1440
          ? `${Math.round(input.durationMinutes / 1440)}d`
          : input.durationMinutes >= 60
          ? `${Math.round(input.durationMinutes / 60)}h`
          : `${input.durationMinutes}m`;

        ctx.logger.info('Silencing alert', { alertname: params.entity.alertname, durationMinutes: input.durationMinutes });

        const res = await fetch(`${client.alertmanagerUrl}/api/v2/silences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matchers,
            startsAt: new Date().toISOString(),
            endsAt,
            createdBy: 'drift-plugin',
            comment: input.comment || `Silenced for ${durationLabel} via Drift`,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) return { success: false, message: `Alertmanager returned HTTP ${res.status}` };

        return {
          success: true,
          message: `Silenced "${params.entity.alertname}" for ${durationLabel}`,
        };
      },
    },
  ],

  resolve: async ({ id }: { id: string }, ctx: EntityResolverContext) => {
    const client = getClient(ctx);
    if (!client) return null;

    ctx.logger.info('Resolving active_alert', { fingerprint: id });

    try {
      const alerts = await fetchAlerts(client.alertmanagerUrl);
      const alert = alerts.find((a: any) => a.fingerprint === id);
      return alert ? alertToEntity(alert) : null;
    } catch (err) {
      ctx.logger.error('Failed to resolve active_alert', {
        fingerprint: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  search: async (query: string, options, ctx: EntityResolverContext) => {
    const client = getClient(ctx);
    if (!client) return [];

    ctx.logger.info('Searching active_alerts', { query });

    try {
      const alerts = await fetchAlerts(client.alertmanagerUrl);
      let filtered = alerts;

      if (query && query !== '*') {
        const q = query.toLowerCase();
        filtered = alerts.filter((a: any) =>
          a.labels?.alertname?.toLowerCase().includes(q) ||
          a.annotations?.summary?.toLowerCase().includes(q) ||
          a.labels?.severity?.toLowerCase().includes(q)
        );
      }

      return filtered.slice(0, options?.limit ?? 20).map(alertToEntity);
    } catch (err) {
      ctx.logger.error('Failed to search active_alerts', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
});
