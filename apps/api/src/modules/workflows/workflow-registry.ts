import { Injectable } from '@nestjs/common';
import type { WorkflowProcess } from '@hrm/business-rules';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';

/** What a module tells the engine about its requests (registered at module start-up). */
export interface WorkflowHandler {
  process: WorkflowProcess;
  /** One-line summaries for the approvals inbox. */
  summaries(tx: TenantTransaction, subjectIds: string[]): Promise<Map<string, string>>;
  /** Web route of a request. */
  link(subjectId: string): string;
  /** The module's own decision endpoint logic (which calls the engine and applies effects). */
  decide(
    principal: AuthPrincipal,
    subjectId: string,
    decision: 'APPROVED' | 'REJECTED',
    note: string | null,
  ): Promise<unknown>;
}

/** Process → module handler; lets the shared inbox route decisions without import cycles. */
@Injectable()
export class WorkflowRegistry {
  private readonly handlers = new Map<WorkflowProcess, WorkflowHandler>();

  register(h: WorkflowHandler): void {
    this.handlers.set(h.process, h);
  }

  get(process: WorkflowProcess): WorkflowHandler | undefined {
    return this.handlers.get(process);
  }
}
