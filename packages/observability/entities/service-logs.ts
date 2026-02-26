/**
 * service_logs entity — A Loki service stream.
 *
 * URI: @drift//service_logs/<service>
 *
 * Resolves from Loki's label values API for the "service" label.
 * The entity-drawer (LogsDrawer.tsx) renders a live log tail.
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext } from '@drift/entity-sdk';

// ─── Schema ───────────────────────────────────────────────────────────────

const serviceLogsSchema = z.object({
  id: z.string(),                      // service name
  type: z.literal('service_logs'),
  uri: z.string(),
  service: z.string(),
});

type ServiceLogs = z.infer<typeof serviceLogsSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────

function getClient(ctx: EntityResolverContext): any {
  return (ctx as any).integrations?.observability?.client ?? null;
}

async function fetchServices(lokiUrl: string, lokiUser: string | null, lokiPassword: string | null): Promise<ServiceLogs[]> {
  const headers: Record<string, string> = {};
  if (lokiUser && lokiPassword) {
    const b64 = Buffer.from(`${lokiUser}:${lokiPassword}`).toString('base64');
    headers.Authorization = `Basic ${b64}`;
  }

  const res = await fetch(`${lokiUrl}/loki/api/v1/label/service/values`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Loki HTTP ${res.status}`);
  const data = await res.json();

  const services: string[] = data?.data ?? [];
  return services.map(service => ({
    id: service,
    type: 'service_logs' as const,
    uri: `@drift//service_logs/${service}`,
    service,
  }));
}

// ─── Entity definition ────────────────────────────────────────────────────

export default defineEntity({
  type: 'service_logs',
  displayName: 'Service Logs',
  description: 'Loki service stream with live log tail',
  icon: 'file-text',

  schema: serviceLogsSchema,

  uriPath: {
    segments: ['id'] as const,
    parse: (segments: string[]) => ({ id: segments[0] }),
    format: ({ id }: { id: string }) => id,
  },

  display: {
    emoji: '📋',
    colors: { bg: '#f59e0b', text: '#ffffff', border: '#d97706' },
    description: 'Loki service log streams',
    outputFields: [
      { key: 'service', label: 'Service', metadataPath: 'service', format: 'string' },
    ],
  },

  integrations: { observability: 'observability' },

  cache: { ttl: 60_000, maxSize: 100 },

  resolve: async ({ id }: { id: string }, ctx: EntityResolverContext) => {
    const client = getClient(ctx);
    if (!client) return null;

    // Loki services are resolved lazily — just return the entity if the service label exists
    try {
      const services = await fetchServices(client.lokiUrl, client.lokiUser, client.lokiPassword);
      return services.find(s => s.id === id) ?? {
        id,
        type: 'service_logs' as const,
        uri: `@drift//service_logs/${id}`,
        service: id,
      };
    } catch (err) {
      ctx.logger.error('Failed to resolve service_logs', {
        service: id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Return a minimal entity even on error so the drawer can attempt to load logs
      return { id, type: 'service_logs' as const, uri: `@drift//service_logs/${id}`, service: id };
    }
  },

  search: async (query: string, options: any, ctx: EntityResolverContext) => {
    const client = getClient(ctx);
    if (!client) return [];

    try {
      const services = await fetchServices(client.lokiUrl, client.lokiUser, client.lokiPassword);
      const q = query?.toLowerCase();
      const filtered = q && q !== '*'
        ? services.filter(s => s.service.toLowerCase().includes(q))
        : services;
      return filtered.slice(0, options?.limit ?? 20);
    } catch (err) {
      ctx.logger.error('Failed to search service_logs', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
});
