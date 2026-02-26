/**
 * Observability Integration — Prometheus, Loki, Alertmanager, Grafana.
 *
 * No authentication required for the local dev stack.
 * createClient always returns a non-null client with default URLs.
 * URLs are configurable via plugin storage (written by the Settings UI).
 */

import { z } from 'zod';
import { defineIntegration } from '@drift/entity-sdk';

export interface ObsClient {
  prometheusUrl: string;
  lokiUrl: string;
  alertmanagerUrl: string;
  grafanaUrl: string;
}

const DEFAULT_URLS = {
  prometheusUrl: 'http://localhost:9090',
  lokiUrl: 'http://localhost:3100',
  alertmanagerUrl: 'http://localhost:9093',
  grafanaUrl: 'http://localhost:3200',
};

// ─── Integration definition ────────────────────────────────────────────────

export default defineIntegration<ObsClient>({
  id: 'observability',
  displayName: 'Observability',
  description: 'Prometheus, Loki, Alertmanager, and Grafana stack monitoring',
  icon: 'activity',

  secureKeys: [],

  createClient: async (ctx) => {
    const prometheusUrl = (await ctx.storage.get('prometheusUrl')) || DEFAULT_URLS.prometheusUrl;
    const lokiUrl = (await ctx.storage.get('lokiUrl')) || DEFAULT_URLS.lokiUrl;
    const alertmanagerUrl = (await ctx.storage.get('alertmanagerUrl')) || DEFAULT_URLS.alertmanagerUrl;
    const grafanaUrl = (await ctx.storage.get('grafanaUrl')) || DEFAULT_URLS.grafanaUrl;
    return { prometheusUrl, lokiUrl, alertmanagerUrl, grafanaUrl };
  },

  methods: [
    {
      id: 'test_connection',
      description: 'Test connectivity to all observability services',
      aiHint: 'Use to verify Prometheus, Loki, Alertmanager, and Grafana are reachable. Returns up/down status for each.',
      handler: async (client) => {
        const checks: [string, string][] = [
          ['prometheus', `${client.prometheusUrl}/-/healthy`],
          ['loki', `${client.lokiUrl}/ready`],
          ['alertmanager', `${client.alertmanagerUrl}/-/healthy`],
          ['grafana', `${client.grafanaUrl}/api/health`],
        ];

        const results: Record<string, string> = {};
        await Promise.allSettled(checks.map(async ([name, url]) => {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            results[name] = res.ok ? 'up' : `down (HTTP ${res.status})`;
          } catch (e: any) {
            results[name] = `down (${e?.message ?? 'unreachable'})`;
          }
        }));

        return { services: results };
      },
    },

    {
      id: 'query_prometheus',
      description: 'Execute an instant PromQL query',
      aiHint: 'Use to query Prometheus metrics. Examples: "up", "count(up == 1)", "rate(http_requests_total[5m])".',
      inputSchema: z.object({
        query: z.string().describe('PromQL expression to evaluate'),
      }),
      handler: async (client, input) => {
        const { query } = input as { query: string };
        const url = `${client.prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`Prometheus returned HTTP ${res.status}`);
        const json = await res.json();
        const result = json.data?.result ?? [];
        return {
          query,
          results: result.map((r: any) => ({
            labels: r.metric,
            value: r.value?.[1],
            timestamp: r.value?.[0],
          })),
        };
      },
    },

    {
      id: 'get_alerts',
      description: 'Get all currently active alerts from Alertmanager',
      aiHint: 'Use to see what alerts are currently firing or silenced. Returns each alert with its labels, annotations, severity, and state.',
      handler: async (client) => {
        const res = await fetch(`${client.alertmanagerUrl}/api/v2/alerts`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`Alertmanager returned HTTP ${res.status}`);
        const alerts = await res.json();
        return {
          count: alerts.length,
          alerts: alerts.map((a: any) => ({
            fingerprint: a.fingerprint,
            alertname: a.labels?.alertname,
            severity: a.labels?.severity,
            state: a.status?.state,
            summary: a.annotations?.summary,
            description: a.annotations?.description,
            startsAt: a.startsAt,
            silencedBy: a.status?.silencedBy ?? [],
          })),
        };
      },
    },

    {
      id: 'silence_alert',
      description: 'Create a silence to suppress an alert for a specified duration',
      aiHint: 'Use to suppress a firing alert. durationMinutes: 15, 60, 240, 1440. comment is optional. The silence matches on alertname label.',
      inputSchema: z.object({
        alertname: z.string().describe('The alertname label value to silence'),
        durationMinutes: z.number().int().min(1).max(10080).describe('Silence duration in minutes (e.g. 60 for 1 hour)'),
        comment: z.string().optional().describe('Reason for silencing this alert'),
      }),
      mutation: true,
      handler: async (client, input) => {
        const { alertname, durationMinutes, comment } = input as {
          alertname: string;
          durationMinutes: number;
          comment?: string;
        };

        const startsAt = new Date().toISOString();
        const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
        const durationLabel = durationMinutes >= 1440
          ? `${Math.round(durationMinutes / 1440)}d`
          : durationMinutes >= 60
          ? `${Math.round(durationMinutes / 60)}h`
          : `${durationMinutes}m`;

        const body = {
          matchers: [{ name: 'alertname', value: alertname, isRegex: false }],
          startsAt,
          endsAt,
          createdBy: 'drift-plugin',
          comment: comment || `Silenced for ${durationLabel} via Drift`,
        };

        const res = await fetch(`${client.alertmanagerUrl}/api/v2/silences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) throw new Error(`Alertmanager returned HTTP ${res.status}`);
        const result = await res.json();
        return {
          success: true,
          silenceId: result.silenceID,
          message: `Silenced "${alertname}" for ${durationLabel}`,
        };
      },
    },

    {
      id: 'query_loki',
      description: 'Query Loki logs with LogQL',
      aiHint: 'Use to search logs. Examples: \'{service="drift-web"} | json\', \'{service=~".+"} | json | level="error"\'. Returns recent log entries.',
      inputSchema: z.object({
        logql: z.string().describe('LogQL query expression'),
        limit: z.number().int().min(1).max(500).optional().describe('Max log lines to return (default 50)'),
        since: z.string().optional().describe('Start time as ISO-8601 string (default: 15 minutes ago)'),
      }),
      handler: async (client, input) => {
        const { logql, limit, since } = input as { logql: string; limit?: number; since?: string };
        const startMs = since ? new Date(since).getTime() : Date.now() - 15 * 60 * 1000;
        const startNs = startMs * 1_000_000;
        const endNs = Date.now() * 1_000_000;

        const url = `${client.lokiUrl}/loki/api/v1/query_range?` +
          `query=${encodeURIComponent(logql)}&` +
          `start=${startNs}&end=${endNs}&` +
          `limit=${limit ?? 50}&direction=backward`;

        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`Loki returned HTTP ${res.status}`);
        const json = await res.json();

        const lines: Array<{ timestamp: string; service: string; level: string; message: string }> = [];
        for (const stream of json.data?.result ?? []) {
          const service = stream.stream?.service || stream.stream?.container || 'unknown';
          const streamLevel = stream.stream?.level || '';
          for (const [tsNs, rawLine] of stream.values ?? []) {
            let message = rawLine;
            let level = streamLevel;
            try {
              const parsed = JSON.parse(rawLine);
              message = parsed.msg || parsed.message || rawLine;
              level = parsed.level || streamLevel;
            } catch {}
            lines.push({
              timestamp: new Date(parseInt(tsNs) / 1_000_000).toISOString(),
              service,
              level,
              message,
            });
          }
        }

        lines.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return { count: lines.length, lines };
      },
    },
  ],
});
