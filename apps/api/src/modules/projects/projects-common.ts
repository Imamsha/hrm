import { Decimal, progressByCategory } from '@hrm/business-rules';
import {
  type BoardCategoryValue,
  type ClientRef,
  PERMISSIONS,
  type ProgressSummary,
  type ProjectRef,
  type ProjectRoleValue,
} from '@hrm/shared-types';
import { AppException } from '../../common/http/app.exception.js';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { myEmployeeId } from '../talent/talent-common.js';

export { dec, empSelect, myEmployeeId, ref, requireMe } from '../talent/talent-common.js';

const P = PERMISSIONS;

export const projectRefSelect = { id: true, key: true, name: true } as const;
export const clientRefSelect = { id: true, code: true, name: true } as const;
export const projectRef = (p: ProjectRef): ProjectRef => ({ id: p.id, key: p.key, name: p.name });
export const clientRef = (c: ClientRef | null): ClientRef | null =>
  c ? { id: c.id, code: c.code, name: c.name } : null;

export interface ProjectAccess {
  projectId: string;
  key: string;
  billingType: 'TIME_AND_MATERIALS' | 'FIXED_FEE' | 'NON_BILLABLE';
  clientId: string | null;
  me: string | null;
  role: ProjectRoleValue | null;
  /** Sees the project (project.read, or a member). */
  read: boolean;
  /** Creates and edits work items (member or manager role, or project.manage). */
  write: boolean;
  /** Members, rates, columns, sprints (project.manage, or the MANAGER role). */
  manage: boolean;
}

/** Resolves what the caller may do on a project; not readable ⇒ 404 (no existence leak). */
export async function projectAccess(
  tx: TenantTransaction,
  principal: AuthPrincipal,
  projectId: string,
): Promise<ProjectAccess> {
  const project = await tx.project.findFirst({
    where: { id: projectId },
    select: { id: true, key: true, billingType: true, clientId: true },
  });
  if (!project) throw AppException.notFound('Project');
  const me = await myEmployeeId(tx, principal);
  const member = me
    ? await tx.projectMember.findFirst({
        where: { projectId, employeeId: me },
        select: { role: true },
      })
    : null;
  const role = member?.role ?? null;
  const manageAll = can(principal, P.PROJECTS_PROJECT_MANAGE, {});
  const read = manageAll || can(principal, P.PROJECTS_PROJECT_READ, {}) || role !== null;
  if (!read) throw AppException.notFound('Project');
  return {
    projectId: project.id,
    key: project.key,
    billingType: project.billingType,
    clientId: project.clientId,
    me,
    role,
    read,
    write: manageAll || role === 'MANAGER' || role === 'MEMBER',
    manage: manageAll || role === 'MANAGER',
  };
}

export function requireWrite(a: ProjectAccess): void {
  if (!a.write) throw AppException.forbidden('Only project members can change work items');
}
export function requireManage(a: ProjectAccess): void {
  if (!a.manage) throw AppException.forbidden('Only the project manager can do this');
}

/** Project ids the caller may read (null = all). */
export async function readableProjectIds(
  tx: TenantTransaction,
  principal: AuthPrincipal,
): Promise<string[] | null> {
  if (can(principal, P.PROJECTS_PROJECT_READ, {}) || can(principal, P.PROJECTS_PROJECT_MANAGE, {}))
    return null;
  const me = await myEmployeeId(tx, principal);
  if (!me) return [];
  const rows = await tx.projectMember.findMany({
    where: { employeeId: me },
    select: { projectId: true },
  });
  return rows.map((r) => r.projectId);
}

/** Item counts by board category for many projects at once. */
export async function progressOf(
  tx: TenantTransaction,
  projectIds: string[],
  onlyClientVisible = false,
): Promise<Map<string, ProgressSummary>> {
  if (!projectIds.length) return new Map();
  const rows = await tx.workItem.findMany({
    where: {
      projectId: { in: projectIds },
      type: { notIn: ['EPIC', 'FEATURE'] },
      ...(onlyClientVisible ? { clientVisible: true } : {}),
    },
    select: { projectId: true, column: { select: { category: true } } },
  });
  const byProject = new Map<string, { category: BoardCategoryValue }[]>();
  for (const r of rows) {
    const list = byProject.get(r.projectId) ?? [];
    list.push({ category: r.column.category });
    byProject.set(r.projectId, list);
  }
  return new Map(
    projectIds.map((id) => {
      const p = progressByCategory(byProject.get(id) ?? []);
      return [
        id,
        {
          todo: p.todo.toString(),
          inProgress: p.inProgress.toString(),
          done: p.done.toString(),
          percentDone: p.percentDone.toString(),
        },
      ];
    }),
  );
}

export const money = (v: { toString(): string } | null | undefined): string | null =>
  v === null || v === undefined ? null : new Decimal(v.toString()).toFixed(2);
