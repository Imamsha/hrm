import { Injectable, Logger } from '@nestjs/common';
import type { AuthEventItem } from '@hrm/shared-types';
import { type AuthEventType, Prisma } from '../../../generated/prisma/client.js';
import { RequestContext } from '../../common/context/request-context.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';

export interface SecurityEvent {
  type: AuthEventType;
  userId?: string | null;
  email?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Security audit / login history (global, append-only `auth_events`). */
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Records an event. Never throws: a logging failure must not break authentication. */
  async record(event: SecurityEvent, tx?: TenantTransaction): Promise<void> {
    const ctx = RequestContext.get();
    const client = tx ?? this.prisma;
    try {
      await client.authEvent.create({
        data: {
          type: event.type,
          userId: event.userId ?? null,
          email: event.email ?? null,
          sessionId: event.sessionId ?? null,
          ipAddress: ctx?.ipAddress ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
          metadata: event.metadata ? (event.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      });
    } catch (err) {
      if (tx) throw err;
      this.logger.error({ err, type: event.type }, 'Failed to record security event');
    }
  }

  async listForUser(userId: string, limit = 50): Promise<AuthEventItem[]> {
    const rows = await this.prisma.authEvent.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      occurredAt: r.occurredAt.toISOString(),
    }));
  }
}
