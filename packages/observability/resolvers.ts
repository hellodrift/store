/**
 * Observability GraphQL Resolvers
 *
 * All HTTP calls use native fetch (Node 18+ / Electron).
 * Errors are caught and logged; queries return empty/null rather than throwing.
 *
 * Context shape:
 *   ctx.integrations.observability.client — ObsClient { prometheusUrl, lokiUrl, ... }
 *   ctx.logger — scoped logger
 */

import type { ObsClient } from './integrations/observability';

// ─── Helpers ──────────────────────────────────────────────────────────────

function getClient(ctx: any): ObsClient | null {
  return ctx.integrations?.observability?.client ?? null;
}

/** Build a Basic Auth Authorization header, or empty object if no credentials. */
function basicAuthHeader(user: string | null, pass: string | null): Record<string, string> {
  if (user && pass) {
    const b64 = Buffer.from(`${user}:${pass}`).toString('base64');
    return { Authorization: `Basic ${b64}` };
  }
  return {};
}

/** Build auth headers for Grafana: API key takes priority over basic auth. */
function grafanaAuthHeader(client: ObsClient): Record<string, string> {
  if (client.grafanaApiKey) {
    return { Authorization: `Bearer ${client.grafanaApiKey}` };
  }
  return basicAuthHeader(client.grafanaUser, client.grafanaPassword);
}

async function httpGet(url: string, headers?: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    headers: headers ?? {},
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function httpPost(url: string, body: unknown, headers?: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function humanDuration(startsAt: string): string {
  const ms = Date.now() - new Date(startsAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function alertToGQL(a: any): any {
  return {
    fingerprint: a.fingerprint ?? '',
    alertname: a.labels?.alertname ?? 'unknown',
    severity: a.labels?.severity ?? null,
    state: a.status?.state ?? 'active',
    summary: a.annotations?.summary ?? null,
    description: a.annotations?.description ?? null,
    labels: JSON.stringify(a.labels ?? {}),
    startsAt: a.startsAt ?? new Date().toISOString(),
    duration: humanDuration(a.startsAt ?? new Date().toISOString()),
    generatorURL: a.generatorURL ?? null,
    silencedBy: a.status?.silencedBy ?? [],
  };
}

function promqlValue(result: any): number | null {
  const value = result?.data?.result?.[0]?.value?.[1];
  return value != null ? parseFloat(value) : null;
}

// ─── Resolvers ────────────────────────────────────────────────────────────

export default {
  ActiveAlert: {
    /**
     * linkedContext: Rich markdown context injected into the AI when this alert
     * entity is referenced in a workstream. Makes Claude aware of the incident
     * details (labels, annotations, duration, firing status) for intelligent
     * incident response assistance.
     *
     * parent may be a ResolvedEntity (from the linkedContext system, where
     * parent.id = fingerprint) or a direct GraphQL parent (where
     * parent.fingerprint = fingerprint). Fetches fresh alert data from
     * Alertmanager so it works in both contexts.
     */
    linkedContext: async (parent: any, _args: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return null;

      try {
        // parent.id is set by the linkedContext system (ResolvedEntity.id = fingerprint)
        // parent.fingerprint is set when called from GraphQL
        const fingerprint = parent.id || parent.fingerprint;
        if (!fingerprint) return null;

        // Fetch fresh alert data from Alertmanager by fingerprint
        const alerts: any[] = await httpGet(`${client.alertmanagerUrl}/api/v2/alerts`);
        const rawAlert = alerts.find((a: any) => a.fingerprint === fingerprint);
        if (!rawAlert) return null;

        const alert = alertToGQL(rawAlert);

        const lines: string[] = [
          `## 🚨 Alert: ${alert.alertname}`,
          `- **Severity**: ${alert.severity ?? 'unknown'}`,
          `- **State**: ${alert.state}`,
          `- **Firing for**: ${alert.duration}`,
          `- **Started**: ${alert.startsAt}`,
        ];

        if (alert.summary) {
          lines.push(`- **Summary**: ${alert.summary}`);
        }

        if (alert.description && alert.description !== alert.summary) {
          lines.push('', '### Description', alert.description);
        }

        // Decode labels for context
        if (alert.labels) {
          try {
            const labelMap: Record<string, string> = JSON.parse(alert.labels);
            const keyLabels = Object.entries(labelMap)
              .filter(([k]) => !['alertname', 'severity', '__schema__'].includes(k))
              .map(([k, v]) => `  - ${k}: ${v}`)
              .join('\n');
            if (keyLabels) {
              lines.push('', '### Labels', keyLabels);
            }
          } catch {}
        }

        // Fetch recent related errors from Loki if available
        if (client.lokiUrl) {
          try {
            const labelMap = alert.labels ? JSON.parse(alert.labels) : {};
            const target = labelMap?.service || labelMap?.job;

            if (target) {
              const logql = `{service="${target}"} | json | level=~"error|fatal"`;
              const startNs = (Date.now() - 15 * 60 * 1000) * 1_000_000;
              const endNs = Date.now() * 1_000_000;
              const url = `${client.lokiUrl}/loki/api/v1/query_range?` +
                `query=${encodeURIComponent(logql)}&` +
                `start=${startNs}&end=${endNs}&limit=5&direction=backward`;

              const lokiHeaders = basicAuthHeader(client.lokiUser, client.lokiPassword);
              const lokiData = await httpGet(url, lokiHeaders);
              const recentErrors: string[] = [];
              for (const stream of lokiData?.data?.result ?? []) {
                for (const [, rawLine] of (stream.values ?? []).slice(0, 3)) {
                  let msg = rawLine as string;
                  try { msg = JSON.parse(rawLine).msg || msg; } catch {}
                  recentErrors.push(`  - ${msg}`);
                  if (recentErrors.length >= 3) break;
                }
                if (recentErrors.length >= 3) break;
              }
              if (recentErrors.length > 0) {
                lines.push('', `### Recent errors from \`${target}\``, ...recentErrors);
              }
            }
          } catch {
            // log enrichment failed — skip, don't block
          }
        }

        return lines.join('\n');
      } catch (err: any) {
        ctx.logger.error('Failed to resolve linkedContext for ActiveAlert', {
          fingerprint: parent.id || parent.fingerprint,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },
  },

  Query: {
    obsAlert: async (_: unknown, { fingerprint }: { fingerprint: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return null;

      try {
        const alerts = await httpGet(
          `${client.alertmanagerUrl}/api/v2/alerts`,
          basicAuthHeader(client.alertmanagerUser, client.alertmanagerPassword),
        );
        const alert = alerts.find((a: any) => a.fingerprint === fingerprint);
        return alert ? alertToGQL(alert) : null;
      } catch (err: any) {
        ctx.logger.error('obsAlert failed', { fingerprint, error: err?.message });
        return null;
      }
    },

    obsAlerts: async (_: unknown, __: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const alerts = await httpGet(
          `${client.alertmanagerUrl}/api/v2/alerts`,
          basicAuthHeader(client.alertmanagerUser, client.alertmanagerPassword),
        );
        return (alerts ?? []).map(alertToGQL);
      } catch (err: any) {
        ctx.logger.error('obsAlerts failed', { error: err?.message });
        return [];
      }
    },

    obsSummary: async (_: unknown, __: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client) {
        return {
          alertCount: 0, criticalCount: 0, warningCount: 0,
          healthyTargets: 0, totalTargets: 0, allHealthy: false,
          storageBytes: null, ingestionRate: null, activeSeries: null,
        };
      }

      const promHeaders = basicAuthHeader(client.prometheusUser, client.prometheusPassword);
      const amHeaders = basicAuthHeader(client.alertmanagerUser, client.alertmanagerPassword);

      const [alertsResult, targetsResult, storageResult, ingestionResult, seriesResult] =
        await Promise.allSettled([
          httpGet(`${client.alertmanagerUrl}/api/v2/alerts`, amHeaders),
          httpGet(`${client.prometheusUrl}/api/v1/targets`, promHeaders),
          httpGet(`${client.prometheusUrl}/api/v1/query?query=${encodeURIComponent('prometheus_tsdb_storage_blocks_bytes + prometheus_tsdb_head_chunks_storage_size_bytes')}`, promHeaders),
          httpGet(`${client.prometheusUrl}/api/v1/query?query=${encodeURIComponent('rate(prometheus_tsdb_head_samples_appended_total[5m])')}`, promHeaders),
          httpGet(`${client.prometheusUrl}/api/v1/query?query=${encodeURIComponent('prometheus_tsdb_head_series')}`, promHeaders),
        ]);

      // Alerts
      const alerts: any[] = alertsResult.status === 'fulfilled' ? alertsResult.value ?? [] : [];
      const activeAlerts = alerts.filter((a: any) => a.status?.state === 'active');
      const criticalCount = activeAlerts.filter((a: any) => a.labels?.severity === 'critical').length;
      const warningCount = activeAlerts.filter((a: any) => a.labels?.severity === 'warning').length;

      // Targets
      const activeTargets: any[] = targetsResult.status === 'fulfilled'
        ? targetsResult.value?.data?.activeTargets ?? []
        : [];
      const totalTargets = activeTargets.length;
      const healthyTargets = activeTargets.filter((t: any) => t.health === 'up').length;
      const allHealthy = totalTargets > 0 && healthyTargets === totalTargets && criticalCount === 0;

      // Prometheus stats
      const storageBytes = storageResult.status === 'fulfilled' ? promqlValue(storageResult.value) : null;
      const ingestionRate = ingestionResult.status === 'fulfilled' ? promqlValue(ingestionResult.value) : null;
      const activeSeries = seriesResult.status === 'fulfilled' ? promqlValue(seriesResult.value) : null;

      return {
        alertCount: activeAlerts.length,
        criticalCount,
        warningCount,
        healthyTargets,
        totalTargets,
        allHealthy,
        storageBytes,
        ingestionRate,
        activeSeries,
      };
    },

    obsTargets: async (_: unknown, __: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const data = await httpGet(
          `${client.prometheusUrl}/api/v1/targets`,
          basicAuthHeader(client.prometheusUser, client.prometheusPassword),
        );
        const targets = data?.data?.activeTargets ?? [];
        return targets.map((t: any) => ({
          job: t.labels?.job ?? t.discoveredLabels?.job ?? 'unknown',
          instance: t.labels?.instance ?? t.scrapeUrl ?? 'unknown',
          health: t.health ?? 'unknown',
          lastScrape: t.lastScrape ?? null,
          lastError: t.lastError || null,
        }));
      } catch (err: any) {
        ctx.logger.error('obsTargets failed', { error: err?.message });
        return [];
      }
    },

    obsLogs: async (
      _: unknown,
      { logql, limit, since }: { logql?: string; limit?: number; since?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      const query = logql || '{service=~".+"}';
      const startMs = since ? new Date(since).getTime() : Date.now() - 15 * 60 * 1000;
      const startNs = startMs * 1_000_000;
      const endNs = Date.now() * 1_000_000;
      const maxLines = Math.min(limit ?? 50, 500);

      try {
        const url = `${client.lokiUrl}/loki/api/v1/query_range?` +
          `query=${encodeURIComponent(query)}&` +
          `start=${startNs}&end=${endNs}&` +
          `limit=${maxLines}&direction=backward`;

        const data = await httpGet(url, basicAuthHeader(client.lokiUser, client.lokiPassword));
        const lines: any[] = [];

        for (const stream of data?.data?.result ?? []) {
          const service = stream.stream?.service || stream.stream?.container || 'unknown';
          const streamLevel = stream.stream?.level || 'info';

          for (const [tsNs, rawLine] of stream.values ?? []) {
            let message = rawLine as string;
            let level = streamLevel;

            try {
              const parsed = JSON.parse(rawLine);
              message = parsed.msg || parsed.message || rawLine;
              level = parsed.level || streamLevel;
            } catch {
              // raw string log line
            }

            lines.push({
              timestamp: new Date(parseInt(tsNs as string) / 1_000_000).toISOString(),
              service,
              level: String(level).toLowerCase(),
              message: String(message),
              labels: JSON.stringify(stream.stream ?? {}),
            });
          }
        }

        // Sort newest first
        lines.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return lines.slice(0, maxLines);
      } catch (err: any) {
        ctx.logger.error('obsLogs failed', { query, error: err?.message });
        return [];
      }
    },

    obsLokiLabelValues: async (
      _: unknown,
      { label }: { label: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const startNs = (Date.now() - 24 * 60 * 60 * 1000) * 1_000_000;
        const endNs = Date.now() * 1_000_000;
        const data = await httpGet(
          `${client.lokiUrl}/loki/api/v1/label/${encodeURIComponent(label)}/values?start=${startNs}&end=${endNs}`,
          basicAuthHeader(client.lokiUser, client.lokiPassword),
        );
        return data?.data ?? [];
      } catch (err: any) {
        ctx.logger.error('obsLokiLabelValues failed', { label, error: err?.message });
        return [];
      }
    },

    obsQueryRange: async (
      _: unknown,
      { query, start, end, step }: { query: string; start?: string; end?: string; step?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      const startMs = start ? new Date(start).getTime() : Date.now() - 60 * 60_000;
      const endMs   = end   ? new Date(end).getTime()   : Date.now();
      const rangeSecs = (endMs - startMs) / 1000;
      const autoStep  = `${Math.max(15, Math.ceil(rangeSecs / 200))}s`;
      const stepParam = step || autoStep;

      try {
        const url = `${client.prometheusUrl}/api/v1/query_range?` +
          `query=${encodeURIComponent(query)}&` +
          `start=${startMs / 1000}&end=${endMs / 1000}&step=${stepParam}`;

        const data = await httpGet(url, basicAuthHeader(client.prometheusUser, client.prometheusPassword));
        return (data?.data?.result ?? []).map((r: any) => ({
          metric: JSON.stringify(r.metric ?? {}),
          values: r.values ?? [],
        }));
      } catch (err: any) {
        ctx.logger.error('obsQueryRange failed', { query, error: err?.message });
        return [];
      }
    },

    obsMetricNames: async (
      _: unknown,
      { job }: { job?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const matchParam = job ? `?match[]=${encodeURIComponent(`{job="${job}"}`)}` : '';
        const data = await httpGet(
          `${client.prometheusUrl}/api/v1/label/__name__/values${matchParam}`,
          basicAuthHeader(client.prometheusUser, client.prometheusPassword),
        );
        return data?.data ?? [];
      } catch (err: any) {
        ctx.logger.error('obsMetricNames failed', { job, error: err?.message });
        return [];
      }
    },

    obsJobTargets: async (
      _: unknown,
      { job }: { job: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const data = await httpGet(
          `${client.prometheusUrl}/api/v1/targets`,
          basicAuthHeader(client.prometheusUser, client.prometheusPassword),
        );
        return (data?.data?.activeTargets ?? [])
          .filter((t: any) => (t.labels?.job ?? t.discoveredLabels?.job ?? '') === job)
          .map((t: any) => ({
            job: t.labels?.job ?? 'unknown',
            instance: t.labels?.instance ?? 'unknown',
            health: t.health ?? 'unknown',
            lastScrape: t.lastScrape ?? null,
            lastError: t.lastError || null,
          }));
      } catch (err: any) {
        ctx.logger.error('obsJobTargets failed', { job, error: err?.message });
        return [];
      }
    },

    obsPromLabelNames: async (
      _: unknown,
      { metricName, job }: { metricName?: string; job?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      const matchers: string[] = [];
      if (metricName) matchers.push(`__name__="${metricName}"`);
      if (job) matchers.push(`job="${job}"`);
      const matchParam = matchers.length ? `?match[]={${matchers.join(',')}}` : '';

      try {
        const data = await httpGet(
          `${client.prometheusUrl}/api/v1/labels${matchParam}`,
          basicAuthHeader(client.prometheusUser, client.prometheusPassword),
        );
        // Strip internal labels (e.g. __name__)
        return (data?.data ?? []).filter((l: string) => !l.startsWith('__'));
      } catch (err: any) {
        ctx.logger.error('obsPromLabelNames failed', { metricName, job, error: err?.message });
        return [];
      }
    },

    obsPromLabelValues: async (
      _: unknown,
      { label, metricName, job }: { label: string; metricName?: string; job?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      const matchers: string[] = [];
      if (metricName) matchers.push(`__name__="${metricName}"`);
      if (job) matchers.push(`job="${job}"`);
      const matchParam = matchers.length ? `?match[]={${matchers.join(',')}}` : '';

      try {
        const data = await httpGet(
          `${client.prometheusUrl}/api/v1/label/${encodeURIComponent(label)}/values${matchParam}`,
          basicAuthHeader(client.prometheusUser, client.prometheusPassword),
        );
        return data?.data ?? [];
      } catch (err: any) {
        ctx.logger.error('obsPromLabelValues failed', { label, metricName, job, error: err?.message });
        return [];
      }
    },

    obsConfig: async (_: unknown, __: unknown, ctx: any) => {
      const client = getClient(ctx);
      const status = client?.getAuthStatus?.() ?? {
        grafanaAuthType: null,
        prometheusAuth: false,
        lokiAuth: false,
        alertmanagerAuth: false,
      };
      return {
        prometheusUrl: client?.prometheusUrl ?? DEFAULT_URLS.prometheusUrl,
        lokiUrl: client?.lokiUrl ?? DEFAULT_URLS.lokiUrl,
        alertmanagerUrl: client?.alertmanagerUrl ?? DEFAULT_URLS.alertmanagerUrl,
        grafanaUrl: client?.grafanaUrl ?? DEFAULT_URLS.grafanaUrl,
        ...status,
      };
    },
  },

  Mutation: {
    obsSilenceAlert: async (
      _: unknown,
      {
        alertname,
        labels,
        durationMinutes,
        comment,
      }: { alertname: string; labels?: string; durationMinutes: number; comment?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No observability client configured' };

      ctx.logger.info('Creating alert silence', { alertname, durationMinutes });

      try {
        // Build matchers from labels JSON if provided, else match on alertname only
        let matchers: Array<{ name: string; value: string; isRegex: boolean }>;

        if (labels) {
          try {
            const labelMap: Record<string, string> = JSON.parse(labels);
            matchers = Object.entries(labelMap).map(([name, value]) => ({
              name,
              value: String(value),
              isRegex: false,
            }));
          } catch {
            matchers = [{ name: 'alertname', value: alertname, isRegex: false }];
          }
        } else {
          matchers = [{ name: 'alertname', value: alertname, isRegex: false }];
        }

        const endsAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
        const durationLabel = durationMinutes >= 1440
          ? `${Math.round(durationMinutes / 1440)}d`
          : durationMinutes >= 60
          ? `${Math.round(durationMinutes / 60)}h`
          : `${durationMinutes}m`;

        await httpPost(
          `${client.alertmanagerUrl}/api/v2/silences`,
          {
            matchers,
            startsAt: new Date().toISOString(),
            endsAt,
            createdBy: 'drift-plugin',
            comment: comment || `Silenced for ${durationLabel} via Drift`,
          },
          basicAuthHeader(client.alertmanagerUser, client.alertmanagerPassword),
        );

        return {
          success: true,
          message: `Silenced "${alertname}" for ${durationLabel}`,
        };
      } catch (err: any) {
        ctx.logger.error('obsSilenceAlert failed', { alertname, error: err?.message });
        return {
          success: false,
          message: `Failed to silence: ${err?.message ?? String(err)}`,
        };
      }
    },

    saveObsSettings: async (
      _: unknown,
      { input }: { input: Record<string, string | null | undefined> },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client?.saveSettings) {
        return { success: false, message: 'Integration client unavailable' };
      }

      try {
        await client.saveSettings(input);
        ctx.logger.info('Observability settings saved');
        return { success: true, message: 'Settings saved' };
      } catch (err: any) {
        ctx.logger.error('saveObsSettings failed', { error: err?.message });
        return { success: false, message: err?.message ?? 'Failed to save settings' };
      }
    },
  },
};

// Default URLs (mirrored here for obsConfig fallback)
const DEFAULT_URLS = {
  prometheusUrl: 'http://localhost:9090',
  lokiUrl: 'http://localhost:3100',
  alertmanagerUrl: 'http://localhost:9093',
  grafanaUrl: 'http://localhost:3200',
};
