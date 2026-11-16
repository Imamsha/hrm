export type DependencyStatus = 'up' | 'down';

export interface DependencyHealth {
  status: DependencyStatus;
  /** Round-trip latency of the probe in milliseconds. */
  latencyMs: number;
  /** Present only when the dependency is down. Never contains secrets. */
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  environment: string;
  uptimeSeconds: number;
  checks: {
    database: DependencyHealth;
    redis: DependencyHealth;
    storage: DependencyHealth;
    queue: DependencyHealth;
  };
}

export interface LivenessReport {
  status: 'ok';
  uptimeSeconds: number;
}
