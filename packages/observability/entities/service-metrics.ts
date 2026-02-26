/**
 * service_metrics entity — A Prometheus scrape job.
 *
 * URI: @drift//service_metrics/<job>
 *
 * Resolves from the Prometheus /api/v1/targets endpoint.
 * The entity-drawer (MetricsDrawer.tsx) renders time-series graphs.
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext } from '@drift/entity-sdk';

// ─── Schema ───────────────────────────────────────────────────────────────

const serviceMetricsSchema = z.object({
  id: z.string(),                        // job name
  type: z.literal('service_metrics'),
  uri: z.string(),
  job: z.string(),
  instanceCount: z.number().optional(),  // total scrape targets
  healthyCount: z.number().optional(),   // targets with health === "up"
});

type ServiceMetrics = z.infer<typeof serviceMetricsSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────

function getClient(ctx: EntityResolverContext): any {
  return (ctx as any).integrations?.observability?.client ?? null;
}

async function fetchTargetJobs(prometheusUrl: string, prometheusUser: string | null, prometheusPassword: string | null): Promise<ServiceMetrics[]> {
  const headers: Record<string, string> = {};
  if (prometheusUser && prometheusPassword) {
    const b64 = Buffer.from(`${prometheusUser}:${prometheusPassword}`).toString('base64');
    headers.Authorization = `Basic ${b64}`;
  }

  const res = await fetch(`${prometheusUrl}/api/v1/targets`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Prometheus HTTP ${res.status}`);
  const data = await res.json();

  const targets: any[] = data?.data?.activeTargets ?? [];
  const jobMap = new Map<string, { total: number; healthy: number }>();

  for (const t of targets) {
    const job = t.labels?.job ?? t.discoveredLabels?.job ?? 'unknown';
    const entry = jobMap.get(job) ?? { total: 0, healthy: 0 };
    entry.total++;
    if (t.health === 'up') entry.healthy++;
    jobMap.set(job, entry);
  }

  return Array.from(jobMap.entries()).map(([job, { total, healthy }]) => ({
    id: job,
    type: 'service_metrics' as const,
    uri: `@drift//service_metrics/${job}`,
    job,
    instanceCount: total,
    healthyCount: healthy,
  }));
}

// ─── Entity definition ────────────────────────────────────────────────────

export default defineEntity({
  type: 'service_metrics',
  displayName: 'Service Metrics',
  description: 'Prometheus scrape job with time-series metrics',
  icon: 'activity',

  schema: serviceMetricsSchema,

  uriPath: {
    segments: ['id'] as const,
    parse: (segments: string[]) => ({ id: segments[0] }),
    format: ({ id }: { id: string }) => id,
  },

  display: {
    emoji: '📈',
    colors: { bg: '#0ea5e9', text: '#ffffff', border: '#0284c7' },
    description: 'Prometheus scrape jobs for metric visualization',
    outputFields: [
      { key: 'job', label: 'Job', metadataPath: 'job', format: 'string' },
      { key: 'instanceCount', label: 'Instances', metadataPath: 'instanceCount', format: 'string' },
      { key: 'healthyCount', label: 'Healthy', metadataPath: 'healthyCount', format: 'string' },
    ],
  },

  integrations: { observability: 'observability' },

  cache: { ttl: 30_000, maxSize: 50 },

  resolve: async ({ id }: { id: string }, ctx: EntityResolverContext) => {
    const client = getClient(ctx);
    if (!client) return null;

    try {
      const jobs = await fetchTargetJobs(client.prometheusUrl, client.prometheusUser, client.prometheusPassword);
      return jobs.find(j => j.id === id) ?? null;
    } catch (err) {
      ctx.logger.error('Failed to resolve service_metrics', {
        job: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  search: async (query: string, options: any, ctx: EntityResolverContext) => {
    const client = getClient(ctx);
    if (!client) return [];

    try {
      const jobs = await fetchTargetJobs(client.prometheusUrl, client.prometheusUser, client.prometheusPassword);
      const q = query?.toLowerCase();
      const filtered = q && q !== '*'
        ? jobs.filter(j => j.job.toLowerCase().includes(q))
        : jobs;
      return filtered.slice(0, options?.limit ?? 20);
    } catch (err) {
      ctx.logger.error('Failed to search service_metrics', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
});
