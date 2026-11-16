import type { DependencyHealth, HealthReport } from '@hrm/shared-types';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const healthReportQueryKey = ['health', 'report'] as const;

export function useHealthReport() {
  return useQuery({
    queryKey: healthReportQueryKey,
    queryFn: ({ signal }) => api.health.report(signal),
    refetchInterval: 15_000,
  });
}

export interface DependencyRow extends DependencyHealth {
  id: keyof HealthReport['checks'];
  name: string;
  description: string;
}

const meta: Record<DependencyRow['id'], { name: string; description: string }> = {
  database: { name: 'PostgreSQL', description: 'Primary database (runtime role, RLS enforced)' },
  redis: { name: 'Redis', description: 'Cache, rate limiting and locks' },
  queue: { name: 'Job queue', description: 'BullMQ queues and workers' },
  storage: { name: 'Object storage', description: 'S3-compatible document storage' },
};

/** Flattens the report into table rows in a stable display order. */
export function toDependencyRows(report: HealthReport): DependencyRow[] {
  return (['database', 'redis', 'queue', 'storage'] as const).map((id) => ({
    id,
    ...meta[id],
    ...report.checks[id],
  }));
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${String(d)}d ${String(h)}h`;
  if (h > 0) return `${String(h)}h ${String(m)}m`;
  if (m > 0) return `${String(m)}m`;
  return `${String(seconds)}s`;
}
