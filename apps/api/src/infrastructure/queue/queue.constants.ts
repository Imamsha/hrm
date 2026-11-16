/** Queue names. Domain queues (payroll, notifications, ai-ingestion, ...) are added by their modules. */
export const QueueName = {
  SYSTEM: 'system',
} as const;

export const SystemJob = {
  /** Round-trip job proving the queue + worker pipeline works end to end. */
  SELF_TEST: 'system.self-test',
} as const;

export const QUEUE_PREFIX = 'hrm';
